import type { BinutilsOutputParser } from '../gnu/GnuBinutilsAdapter';
import {
  GnuBinutilsParser,
  GnuRegion,
} from '../gnu/GnuBinutilsParser';

/** Parses llvm-objdump sections and delegates compatible llvm-nm output. */
export class LlvmObjectParser implements BinutilsOutputParser {
  private readonly symbolParser: GnuBinutilsParser;

  constructor(debug: boolean = false) {
    this.symbolParser = new GnuBinutilsParser(debug);
  }

  parseSections(stdout: string, regions: GnuRegion[]): void {
    const sectionPattern = /^\s*\d+\s+(\S+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+(.+)$/i;
    let assignedSections = 0;

    for (const line of stdout.split(/\r?\n/)) {
      const match = sectionPattern.exec(line);
      if (!match) {
        continue;
      }
      const type = match[5].trim().toUpperCase();
      if (!/\b(?:TEXT|DATA|BSS)\b/.test(type)) {
        continue;
      }
      const name = match[1];
      const size = parseHex(match[2], `section ${name} size`);
      const runtimeAddress = parseHex(match[3], `section ${name} VMA`);
      const loadAddress = parseHex(match[4], `section ${name} LMA`);
      if (size === 0) {
        continue;
      }

      const runtimeRegion = findRegion(regions, runtimeAddress);
      if (runtimeRegion) {
        addSection(runtimeRegion, name, runtimeAddress, loadAddress, size);
        assignedSections++;
      }
      const loadRegion = type !== 'BSS' && loadAddress !== runtimeAddress
        ? findRegion(regions, loadAddress)
        : undefined;
      if (loadRegion) {
        addSection(loadRegion, name, loadAddress, loadAddress, size);
        assignedSections++;
      }
    }

    if (regions.length > 0 && assignedSections === 0) {
      throw new Error(
        'Embedded Build Analyzer: llvm-objdump reported no TEXT, DATA, or BSS '
        + 'sections matching the linker-script MEMORY regions.'
      );
    }
  }

  parseSymbols(
    stdout: string,
    regions: GnuRegion[],
    sourceBaseDirectory: string
  ): void {
    this.symbolParser.parseSymbols(stdout, regions, sourceBaseDirectory);
  }
}

function addSection(
  region: GnuRegion,
  name: string,
  startAddress: number,
  loadAddress: number,
  size: number
): void {
  region.sections.push({ name, startAddress, loadAddress, size, symbols: [] });
  region.used += size;
}

function findRegion(regions: readonly GnuRegion[], address: number): GnuRegion | undefined {
  return regions.find(region =>
    address >= region.startAddress && address < region.startAddress + region.size
  );
}

function parseHex(value: string, field: string): number {
  const parsed = Number.parseInt(value, 16);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Embedded Build Analyzer: llvm-objdump reported invalid ${field}.`);
  }
  return parsed;
}
