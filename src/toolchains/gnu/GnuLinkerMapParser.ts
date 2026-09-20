import * as fs from 'fs';
import type { GnuRegion } from './GnuBinutilsParser';

const LOG_PREFIX = '[GNU Linker MAP Parser]';

export class GnuLinkerMapParser {
  constructor(private readonly debug: boolean = false) {}

  parseFile(mapFile: string): GnuRegion[] {
    let content: string;
    try {
      content = fs.readFileSync(mapFile, 'utf8');
    } catch (error) {
      throw new Error(
        `STM32 Build Analyzer: cannot read MAP file "${mapFile}": `
        + errorMessage(error)
      );
    }

    return this.parse(content, mapFile);
  }

  parse(content: string, mapFile: string): GnuRegion[] {
    if (content.trim().length === 0) {
      throw new Error(`STM32 Build Analyzer: MAP file is empty: "${mapFile}".`);
    }

    const lines = content.split('\n');
    const regions: GnuRegion[] = [];
    const regionPattern = /^\s*(\S+)\s+(0x[\da-fA-F]+)\s+(0x[\da-fA-F]+)/;
    let inMemoryConfiguration = false;

    for (const line of lines) {
      if (line.startsWith('Memory Configuration')) {
        inMemoryConfiguration = true;
        continue;
      }
      if (line.startsWith('Linker script and memory map')) {
        break;
      }
      if (!inMemoryConfiguration) {
        continue;
      }

      const match = regionPattern.exec(line);
      if (!match) {
        continue;
      }

      const name = match[1];
      if (isGnuCatchAllRegion(name)) {
        if (this.debug) {
          console.log(`${LOG_PREFIX} Skipping catch-all region: ${name}`);
        }
        continue;
      }

      const startAddress = parseSafeHex(match[2], `region ${name} origin`, mapFile);
      const size = parseSafeHex(match[3], `region ${name} length`, mapFile);
      if (!Number.isSafeInteger(startAddress + size)) {
        throw new Error(
          `STM32 Build Analyzer: MAP file "${mapFile}" contains region "${name}" `
          + 'whose address range exceeds JavaScript safe integer precision.'
        );
      }

      regions.push({
        name,
        startAddress,
        size,
        used: 0,
        sections: [],
      });
    }

    if (regions.length === 0) {
      throw new Error(
        `STM32 Build Analyzer: MAP file "${mapFile}" does not contain a supported `
        + 'GNU linker Memory Configuration with at least one usable memory region.'
      );
    }

    return regions;
  }
}

export function isGnuCatchAllRegion(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes('default')
    || normalized.includes('catch-all')
    || normalized.includes('catchall')
    || (name.startsWith('*') && name.endsWith('*'));
}

function parseSafeHex(value: string, field: string, mapFile: string): number {
  const parsed = Number.parseInt(value, 16);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(
      `STM32 Build Analyzer: MAP file "${mapFile}" contains an invalid ${field}: ${value}.`
    );
  }
  return parsed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
