import * as path from 'path';
import type {
  AnalyzedMemoryRegion,
  AnalyzedSection,
  AnalyzedSymbol,
} from '../../analysis/contracts';

const LOG_PREFIX = '[GNU Binutils Parser]';

export interface GnuSymbol extends Omit<AnalyzedSymbol, 'source'> {
  source?: AnalyzedSymbol['source'];
}

export interface GnuSection extends Omit<AnalyzedSection, 'symbols'> {
  symbols: GnuSymbol[];
}

export interface GnuRegion extends Omit<AnalyzedMemoryRegion, 'sections'> {
  used: number;
  sections: GnuSection[];
}

export class GnuBinutilsParser {
  constructor(private readonly debug: boolean = false) {}

  parseSections(stdout: string, regions: GnuRegion[]): void {
    const lines = stdout.split(/\r?\n/);
    const sectionPattern = /^\s*\d+\s+(\S+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)/;
    const allocPattern = /\bALLOC\b/;
    const loadPattern = /\bLOAD\b/;
    const contentsPattern = /\bCONTENTS\b/;
    let previousLine = '';
    let assignedSections = 0;

    for (const line of lines) {
      if (!allocPattern.test(line)) {
        previousLine = line;
        continue;
      }
      const match = sectionPattern.exec(previousLine);
      if (!match) {
        continue;
      }

      const name = match[1];
      const size = parseSafeHex(match[2], `section ${name} size`, 'objdump');
      const runtimeAddress = parseSafeHex(match[3], `section ${name} VMA`, 'objdump');
      const loadAddress = parseSafeHex(match[4], `section ${name} LMA`, 'objdump');
      if (size === 0) {
        continue;
      }

      const runtimeRegion = findRegion(regions, runtimeAddress);
      if (runtimeRegion) {
        this.addSection(
          runtimeRegion,
          name,
          runtimeAddress,
          loadAddress,
          size,
          'runtime'
        );
        assignedSections++;
      }

      const hasLoadImage = loadAddress !== runtimeAddress
        && loadPattern.test(line)
        && contentsPattern.test(line);
      const loadRegion = hasLoadImage ? findRegion(regions, loadAddress) : undefined;
      if (loadRegion) {
        this.addSection(loadRegion, name, loadAddress, loadAddress, size, 'load');
        assignedSections++;
      }
    }

    if (regions.length > 0 && assignedSections === 0) {
      throw new Error(
        'STM32 Build Analyzer: objdump completed successfully, but no allocatable ELF sections '
        + 'matched the map memory regions. Verify that the selected .map and .elf files belong '
        + 'to the same build.'
      );
    }
  }

  parseSymbols(
    stdout: string,
    regions: GnuRegion[],
    sourceBaseDirectory: string
  ): void {
    const lines = stdout.split(/\r?\n/);
    const symbolPattern = /^([0-9A-Fa-f]+)(?:\s+([0-9A-Fa-f]+))?\s+\w\s+(.+)$/;
    const pathPattern = /(.*):(\d+)$/;
    const unmatchedLines: string[] = [];

    for (const line of lines) {
      const match = symbolPattern.exec(line);
      if (!match) {
        if (this.debug) {
          unmatchedLines.push(line);
        }
        continue;
      }

      const startAddress = parseSafeHex(match[1], 'symbol address', 'nm');
      const size = match[2]
        ? parseSafeHex(match[2], 'symbol size', 'nm')
        : null;
      const symbolDetails = match[3];
      const separator = symbolDetails.lastIndexOf('\t');
      const name = (separator >= 0
        ? symbolDetails.slice(0, separator)
        : symbolDetails
      ).trim();
      const rawLocation = separator >= 0
        ? symbolDetails.slice(separator + 1).trim()
        : '';
      const locationMatch = pathPattern.exec(rawLocation);
      const source = locationMatch
        ? {
          path: path.isAbsolute(locationMatch[1])
            ? path.normalize(locationMatch[1])
            : path.resolve(sourceBaseDirectory, locationMatch[1]),
          line: Number.parseInt(locationMatch[2], 10),
          column: null,
        }
        : undefined;

      for (const region of regions) {
        if (
          startAddress < region.startAddress
          || startAddress >= region.startAddress + region.size
        ) {
          continue;
        }
        const section = region.sections.find(candidate =>
          startAddress >= candidate.startAddress
          && startAddress < candidate.startAddress + candidate.size
        );
        if (!section) {
          continue;
        }

        section.symbols.push({ name, startAddress, size, source });
        if (this.debug) {
          console.log(
            `${LOG_PREFIX} Symbol ${name} in section ${section.name} `
            + `(${source?.path ?? ''}:${source?.line ?? 0})`
          );
        }
      }
    }

    if (this.debug && unmatchedLines.length > 0) {
      const maxUnmatched = 10;
      console.log(`${LOG_PREFIX} Unmatched nm lines: ${unmatchedLines.length}`);
      unmatchedLines.slice(0, maxUnmatched).forEach((line, index) => {
        console.log(`  ${index + 1}: "${line}"`);
      });
    }
  }

  private addSection(
    region: GnuRegion,
    name: string,
    startAddress: number,
    loadAddress: number,
    size: number,
    placement: 'runtime' | 'load'
  ): void {
    region.sections.push({ name, startAddress, size, loadAddress, symbols: [] });
    region.used += size;
    if (this.debug) {
      console.log(
        `${LOG_PREFIX} Section ${name} ${placement} image assigned to region ${region.name}`
      );
    }
  }
}

function findRegion(regions: GnuRegion[], address: number): GnuRegion | undefined {
  return regions.find(region =>
    address >= region.startAddress && address < region.startAddress + region.size
  );
}

function parseSafeHex(value: string, field: string, producer: string): number {
  const parsed = Number.parseInt(value, 16);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(
      `STM32 Build Analyzer: ${producer} reported an invalid ${field}: ${value}.`
    );
  }
  return parsed;
}
