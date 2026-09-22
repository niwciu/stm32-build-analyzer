import type {
  AnalyzedMemoryRegion,
  AnalyzedSection,
  AnalyzedSymbol,
} from '../../analysis/contracts';
import {
  ANALYSIS_DIAGNOSTIC_CODES,
  createAnalysisDiagnostic,
} from '../../analysis/diagnostics';
import type { ParsedMapAnalysis } from '../map/MapFileAdapter';
import {
  mapFormatError,
  readMapText,
} from '../map/MapFileAdapter';

interface MutableRegion {
  name: string;
  startAddress: number;
  size: number;
  used: number;
  sections: MutableSection[];
  loadBase: number;
  initializedOffset: number;
}

interface MutableSection extends AnalyzedSection {
  symbols: AnalyzedSymbol[];
}

interface SectionRecord {
  readonly regionName: string;
  readonly name: string;
  readonly address: number;
  readonly loadAddress: number;
  readonly size: number;
  readonly type: string;
}

const REGION_HEADER = /^\s*Execution Region\s+(\S+)\s+\((?:Exec base|Base):\s*(0x[0-9a-f]+),\s*(?:Load base:\s*(0x[0-9a-f]+),\s*)?Size:\s*(0x[0-9a-f]+),\s*Max:\s*(0x[0-9a-f]+)/i;

/** Parses the documented armlink image memory map and symbol table. */
export class KeilMapParser {
  parseFile(mapPath: string): ParsedMapAnalysis {
    const content = readMapText('keil-armclang', mapPath);
    const version = parseVersion(content);
    if (version !== '5.06' && version !== '6.21') {
      throw mapFormatError(
        'keil-armclang',
        mapPath,
        'The MAP file is not a supported Arm Compiler 5.06 or 6.21 armlink report.'
      );
    }
    if (!/^\s*Memory Map of the image\s*$/mi.test(content)) {
      throw mapFormatError(
        'keil-armclang',
        mapPath,
        'The armlink MAP file has no "Memory Map of the image" section.'
      );
    }

    const regions = new Map<string, MutableRegion>();
    const records: SectionRecord[] = [];
    let currentRegion: MutableRegion | undefined;
    let hasExplicitLoadColumn = false;
    let inSymbolTable = false;

    for (const line of content.split(/\r?\n/)) {
      const regionMatch = REGION_HEADER.exec(line);
      if (regionMatch) {
        const name = regionMatch[1];
        if (regions.has(name)) {
          throw mapFormatError(
            'keil-armclang',
            mapPath,
            `The armlink MAP contains duplicate execution region "${name}".`
          );
        }
        const startAddress = parseHex(regionMatch[2]);
        currentRegion = {
          name,
          startAddress,
          size: parseHex(regionMatch[5]),
          used: 0,
          sections: [],
          loadBase: regionMatch[3] ? parseHex(regionMatch[3]) : startAddress,
          initializedOffset: 0,
        };
        regions.set(name, currentRegion);
        hasExplicitLoadColumn = false;
        continue;
      }
      if (/^\s*Image Symbol Table\s*$/i.test(line)) {
        inSymbolTable = true;
        currentRegion = undefined;
        continue;
      }
      if (inSymbolTable) {
        continue;
      }
      if (/\bExec Addr\s+Load Addr\s+Size\b/i.test(line)) {
        hasExplicitLoadColumn = true;
        continue;
      }
      if (/\bBase Addr\s+Size\s+Type\b/i.test(line)) {
        hasExplicitLoadColumn = false;
        continue;
      }
      if (!currentRegion) {
        continue;
      }

      const record = parseSectionRecord(
        line,
        currentRegion,
        hasExplicitLoadColumn
      );
      if (record) {
        records.push(record);
      }
    }

    if (regions.size === 0) {
      throw mapFormatError(
        'keil-armclang',
        mapPath,
        'No supported armlink execution regions were found.'
      );
    }

    let ignoredRecords = 0;
    for (const record of records) {
      const runtimeRegion = regions.get(record.regionName);
      if (!runtimeRegion || !contains(runtimeRegion, record.address)) {
        ignoredRecords++;
        continue;
      }
      runtimeRegion.used += record.size;
      if (record.type !== 'PAD') {
        runtimeRegion.sections.push({
          name: record.name,
          startAddress: record.address,
          size: record.size,
          loadAddress: record.type === 'ZERO' ? null : record.loadAddress,
          symbols: [],
        });
      }

      if (record.type !== 'ZERO' && record.loadAddress !== record.address) {
        const loadRegion = findRegion(regions.values(), record.loadAddress);
        if (loadRegion && loadRegion !== runtimeRegion) {
          loadRegion.used += record.size;
          loadRegion.sections.push({
            name: record.name,
            startAddress: record.loadAddress,
            size: record.size,
            loadAddress: record.loadAddress,
            symbols: [],
          });
        }
      }
    }

    parseSymbols(content, regions.values());
    const warnings = ignoredRecords === 0 ? [] : [createAnalysisDiagnostic({
      code: ANALYSIS_DIAGNOSTIC_CODES.ANALYSIS_PARTIAL,
      severity: 'warning',
      message: `${ignoredRecords} armlink section record(s) were outside their declared execution region and were ignored.`,
      toolchainId: 'keil-armclang',
      artifactPath: mapPath,
      remediation: 'Generate a complete MAP containing every execution-region header.',
    })];

    return {
      regions: [...regions.values()].map(toAnalyzedRegion),
      version: `Arm Compiler ${version}`,
      warnings,
    };
  }
}

function parseVersion(content: string): string | undefined {
  const component = /Component:\s*ARM Compiler\s+([^\s]+)[^\r\n]*Tool:\s*armlink/i.exec(content);
  if (component) {
    return component[1];
  }
  return /\bARM Linker,\s*(\d+(?:\.\d+)+)/i.exec(content)?.[1];
}

function parseSectionRecord(
  line: string,
  region: MutableRegion,
  hasExplicitLoadColumn: boolean
): SectionRecord | undefined {
  const tokens = line.trim().split(/\s+/);
  const required = hasExplicitLoadColumn ? 4 : 3;
  if (tokens.length < required || !isHex(tokens[0]) || !isHex(tokens[1])) {
    return undefined;
  }

  const address = parseHex(tokens[0]);
  const loadAddress = hasExplicitLoadColumn ? parseHex(tokens[1]) : undefined;
  const sizeIndex = hasExplicitLoadColumn ? 2 : 1;
  const typeIndex = sizeIndex + 1;
  if (!isHex(tokens[sizeIndex])) {
    return undefined;
  }
  const size = parseHex(tokens[sizeIndex]);
  const type = tokens[typeIndex].toUpperCase();
  if (!['CODE', 'DATA', 'ZERO', 'PAD'].includes(type)) {
    return undefined;
  }

  let name = type === 'PAD' ? 'PAD' : tokens[typeIndex + 3];
  if (name === '*') {
    name = tokens[typeIndex + 4];
  }
  if (!name) {
    return undefined;
  }

  const resolvedLoadAddress = type === 'ZERO'
    ? address
    : loadAddress
      ?? (region.loadBase === region.startAddress
        ? address
        : region.loadBase + region.initializedOffset);
  if (type !== 'ZERO') {
    region.initializedOffset += size;
  }
  return {
    regionName: region.name,
    name,
    address,
    loadAddress: resolvedLoadAddress,
    size,
    type,
  };
}

function parseSymbols(
  content: string,
  regions: Iterable<MutableRegion>
): void {
  const marker = content.search(/^\s*Image Symbol Table\s*$/mi);
  if (marker < 0) {
    return;
  }
  for (const line of content.slice(marker).split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 5 || !isHex(tokens[1])) {
      continue;
    }
    const thumb = tokens[2]?.toLowerCase() === 'thumb';
    const typeIndex = thumb ? 3 : 2;
    const type = tokens[typeIndex]?.toLowerCase();
    if (type !== 'code' && type !== 'data') {
      continue;
    }
    const sizeValue = tokens[typeIndex + 1];
    if (!/^\d+$/.test(sizeValue) && !isHex(sizeValue)) {
      continue;
    }
    const startAddress = parseHex(tokens[1]);
    const section = findSection(regions, startAddress);
    if (section) {
      section.symbols.push({
        name: tokens[0],
        startAddress,
        size: isHex(sizeValue) ? parseHex(sizeValue) : Number.parseInt(sizeValue, 10),
      });
    }
  }
}

function findSection(
  regions: Iterable<MutableRegion>,
  address: number
): MutableSection | undefined {
  for (const region of regions) {
    const section = region.sections.find(candidate =>
      address >= candidate.startAddress
      && address < candidate.startAddress + candidate.size
    );
    if (section) {
      return section;
    }
  }
  return undefined;
}

function findRegion(
  regions: Iterable<MutableRegion>,
  address: number
): MutableRegion | undefined {
  for (const region of regions) {
    if (contains(region, address)) {
      return region;
    }
  }
  return undefined;
}

function contains(region: MutableRegion, address: number): boolean {
  return address >= region.startAddress
    && address < region.startAddress + region.size;
}

function toAnalyzedRegion(region: MutableRegion): AnalyzedMemoryRegion {
  const { loadBase: _loadBase, initializedOffset: _offset, ...analyzed } = region;
  return analyzed;
}

function isHex(value: string | undefined): value is string {
  return /^0x[0-9a-f]+$/i.test(value ?? '');
}

function parseHex(value: string): number {
  const parsed = Number.parseInt(value, 16);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid armlink hexadecimal value: ${value}`);
  }
  return parsed;
}
