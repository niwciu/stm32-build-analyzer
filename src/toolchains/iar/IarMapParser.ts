import type {
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
}

interface MutableSection extends AnalyzedSection {
  symbols: AnalyzedSymbol[];
}

const RANGE_PLACEMENT = /^\s*"([^"]+)":\s+place in\s+\[from\s+(0x[0-9a-f]+)\s+to\s+(0x[0-9a-f]+)\]/i;
const ABSOLUTE_PLACEMENT = /^\s*"([^"]+)":\s+place at\s+(0x[0-9a-f]+)/i;
const GROUP_HEADER = /^\s*"([^"]+)"(?:,\s+part\s+\d+\s+of\s+\d+)?:/i;

/** Parses numeric ILINK placement ranges, section rows, and entry records. */
export class IarMapParser {
  parseFile(mapPath: string): ParsedMapAnalysis {
    const content = readMapText('iar-arm', mapPath);
    const version = parseVersion(content);
    if (version !== '7.80.1.28' && version !== '9.50.1') {
      throw mapFormatError(
        'iar-arm',
        mapPath,
        'The MAP file is not a supported IAR ILINK 7.80.1.28 or 9.50.1 report.'
      );
    }
    if (!/^\s*\*{0,3}\s*PLACEMENT SUMMARY\s*$/mi.test(content)) {
      throw mapFormatError(
        'iar-arm',
        mapPath,
        'The ILINK MAP file has no placement summary.'
      );
    }

    const regions = parseRegions(content, mapPath);
    let currentRegion: MutableRegion | undefined;
    let absolutePlacements = 0;
    let initializedSections = 0;
    let inPlacementSummary = false;

    for (const line of content.split(/\r?\n/)) {
      if (/^\s*\*{0,3}\s*PLACEMENT SUMMARY\s*$/i.test(line)) {
        inPlacementSummary = true;
        continue;
      }
      if (inPlacementSummary && /^\s*\*{3}\s+(?!PLACEMENT SUMMARY)/i.test(line)) {
        inPlacementSummary = false;
        currentRegion = undefined;
      }
      if (!inPlacementSummary) {
        continue;
      }
      if (ABSOLUTE_PLACEMENT.test(line)) {
        absolutePlacements++;
        continue;
      }
      const group = GROUP_HEADER.exec(line);
      if (group) {
        currentRegion = regions.get(group[1]);
        continue;
      }
      if (!currentRegion) {
        continue;
      }

      const section = parseSection(line, currentRegion);
      if (!section) {
        continue;
      }
      currentRegion.sections.push(section);
      currentRegion.used += section.size;
      if (/\binited\b/i.test(line)) {
        initializedSections++;
      }
    }

    if (regions.size === 0) {
      throw mapFormatError(
        'iar-arm',
        mapPath,
        'No numeric ILINK placement ranges were found; symbolic ICF ranges must be materialized in the MAP report.'
      );
    }

    parseEntryList(content, regions.values());
    const limitations = [
      absolutePlacements > 0
        ? `${absolutePlacements} absolute placement(s) without declared capacity`
        : undefined,
      initializedSections > 0
        ? `${initializedSections} initialized section load image(s) without ROM addresses`
        : undefined,
    ].filter((value): value is string => value !== undefined);
    const warnings = limitations.length === 0 ? [] : [createAnalysisDiagnostic({
      code: ANALYSIS_DIAGNOSTIC_CODES.ANALYSIS_PARTIAL,
      severity: 'warning',
      message: `IAR runtime placement was analyzed; omitted ${limitations.join(' and ')}.`,
      toolchainId: 'iar-arm',
      artifactPath: mapPath,
      remediation: 'Use numeric ranged placements and treat ROM usage as partial when initialized data has no load address.',
    })];

    return {
      regions: [...regions.values()],
      version: `IAR ILINK ${version}`,
      warnings,
      notes: initializedSections > 0
        ? ['ILINK MAP section rows expose runtime addresses but not initialized-data load addresses.']
        : [],
    };
  }
}

function parseVersion(content: string): string | undefined {
  return /\bIAR (?:ELF )?Linker\s+V(\d+(?:\.\d+)+)(?:\/\S+)?\s+for ARM\b/i.exec(content)?.[1]
    ?? /\bIAR (?:ELF )?Linker for Arm\s+V(\d+(?:\.\d+)+)/i.exec(content)?.[1];
}

function parseRegions(
  content: string,
  mapPath: string
): Map<string, MutableRegion> {
  const regions = new Map<string, MutableRegion>();
  for (const line of content.split(/\r?\n/)) {
    const match = RANGE_PLACEMENT.exec(line);
    if (!match) {
      continue;
    }
    const name = match[1];
    if (regions.has(name)) {
      throw mapFormatError(
        'iar-arm',
        mapPath,
        `The ILINK MAP contains duplicate placement range "${name}".`
      );
    }
    const startAddress = parseHex(match[2]);
    const endAddress = parseHex(match[3]);
    const size = endAddress - startAddress + 1;
    if (size <= 0 || !Number.isSafeInteger(startAddress + size)) {
      throw mapFormatError(
        'iar-arm',
        mapPath,
        `Placement range "${name}" has an invalid address interval.`
      );
    }
    regions.set(name, {
      name,
      startAddress,
      size,
      used: 0,
      sections: [],
    });
  }
  return regions;
}

function parseSection(
  line: string,
  region: MutableRegion
): MutableSection | undefined {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 4 || /^[-"]/.test(tokens[0])) {
    return undefined;
  }
  let addressIndex = -1;
  for (let index = 1; index < tokens.length - 1; index++) {
    if (isHex(tokens[index]) && isHex(tokens[index + 1])) {
      addressIndex = index;
      break;
    }
  }
  if (addressIndex < 0 || tokens.slice(addressIndex + 2).join(' ').includes('<Init block>')) {
    return undefined;
  }

  const startAddress = parseHex(tokens[addressIndex]);
  const size = parseHex(tokens[addressIndex + 1]);
  if (!contains(region, startAddress) || size === 0) {
    return undefined;
  }
  return {
    name: tokens[0],
    startAddress,
    size,
    loadAddress: null,
    symbols: [],
  };
}

function parseEntryList(
  content: string,
  regions: Iterable<MutableRegion>
): void {
  const marker = content.search(/^\s*\*{0,3}\s*ENTRY LIST\s*$/mi);
  if (marker < 0) {
    return;
  }
  for (const line of content.slice(marker).split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 4 || !isHex(tokens[1]) || !isHex(tokens[2])) {
      continue;
    }
    const startAddress = parseHex(tokens[1]);
    const section = findSection(regions, startAddress);
    if (section) {
      section.symbols.push({
        name: tokens[0],
        startAddress,
        size: parseHex(tokens[2]),
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

function contains(region: MutableRegion, address: number): boolean {
  return address >= region.startAddress
    && address < region.startAddress + region.size;
}

function isHex(value: string | undefined): value is string {
  return /^0x[0-9a-f]+$/i.test(value ?? '');
}

function parseHex(value: string): number {
  const parsed = Number.parseInt(value, 16);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid ILINK hexadecimal value: ${value}`);
  }
  return parsed;
}
