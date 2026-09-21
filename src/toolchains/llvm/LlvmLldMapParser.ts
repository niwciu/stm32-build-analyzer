import * as fs from 'fs';
import type {
  BinutilsRegionParser,
} from '../gnu/GnuBinutilsAdapter';
import type { GnuRegion } from '../gnu/GnuBinutilsParser';

const LLD_MAP_HEADER = /^\s*VMA\s+LMA\s+Size\s+Align\s+Out\s+In\s+Symbol\s*$/mi;
const MEMORY_REGION = /^\s*([A-Za-z_.$][\w.$-]*)\s*(?:\([^)]*\))?\s*:\s*(?:ORIGIN|org)\s*=\s*([^,\r\n]+),\s*(?:LENGTH|len)\s*=\s*([^;\r\n]+?)\s*;?\s*$/gmi;

/** Parses native LLD MAP validation plus literal MEMORY regions from scripts. */
export class LlvmLldMapParser implements BinutilsRegionParser {
  parseFile(mapFile: string, linkerScriptPaths: readonly string[] = []): GnuRegion[] {
    const map = readText(mapFile, 'LLD MAP');
    if (!LLD_MAP_HEADER.test(map)) {
      throw new Error(
        `Embedded Build Analyzer: MAP file "${mapFile}" does not contain the `
        + 'supported native LLD VMA/LMA/Size/Align/Out/In/Symbol header.'
      );
    }
    if (linkerScriptPaths.length === 0) {
      throw new Error(
        'Embedded Build Analyzer: native LLD analysis requires a linker script '
        + 'with literal MEMORY declarations so region capacities are known.'
      );
    }

    const regions: GnuRegion[] = [];
    const names = new Set<string>();
    for (const scriptPath of linkerScriptPaths) {
      const script = stripComments(readText(scriptPath, 'linker script'));
      for (const block of memoryBlocks(script, scriptPath)) {
        MEMORY_REGION.lastIndex = 0;
        for (let match = MEMORY_REGION.exec(block); match;
          match = MEMORY_REGION.exec(block)) {
          const name = match[1];
          if (names.has(name)) {
            throw new Error(
              `Embedded Build Analyzer: duplicate MEMORY region "${name}" `
              + `while reading "${scriptPath}".`
            );
          }
          const startAddress = parseLiteral(match[2].trim(), 'origin', name);
          const size = parseLiteral(match[3].trim(), 'length', name);
          if (!Number.isSafeInteger(startAddress + size)) {
            throw new Error(
              `Embedded Build Analyzer: MEMORY region "${name}" exceeds `
              + 'JavaScript safe integer precision.'
            );
          }
          names.add(name);
          regions.push({ name, startAddress, size, used: 0, sections: [] });
        }
      }
    }

    if (regions.length === 0) {
      throw new Error(
        'Embedded Build Analyzer: no supported literal MEMORY declarations were '
        + 'found. Computed expressions and generated linker scripts require a '
        + 'materialized script with numeric ORIGIN and LENGTH values.'
      );
    }
    return regions;
  }
}

function memoryBlocks(content: string, scriptPath: string): string[] {
  const blocks: string[] = [];
  const marker = /\bMEMORY\b/g;
  for (let match = marker.exec(content); match; match = marker.exec(content)) {
    const open = content.indexOf('{', marker.lastIndex);
    if (open < 0) {
      throw new Error(
        `Embedded Build Analyzer: unterminated MEMORY declaration in "${scriptPath}".`
      );
    }
    let depth = 1;
    let cursor = open + 1;
    for (; cursor < content.length && depth > 0; cursor++) {
      if (content[cursor] === '{') {
        depth++;
      } else if (content[cursor] === '}') {
        depth--;
      }
    }
    if (depth !== 0) {
      throw new Error(
        `Embedded Build Analyzer: unterminated MEMORY block in "${scriptPath}".`
      );
    }
    blocks.push(content.slice(open + 1, cursor - 1));
    marker.lastIndex = cursor;
  }
  return blocks;
}

function parseLiteral(value: string, field: string, region: string): number {
  const match = /^(0x[0-9a-f]+|\d+)([KMG])?$/i.exec(value);
  if (!match) {
    throw new Error(
      `Embedded Build Analyzer: MEMORY region "${region}" has unsupported ${field} `
      + `expression "${value}"; use a materialized numeric literal.`
    );
  }
  const base = match[1].toLowerCase().startsWith('0x') ? 16 : 10;
  const multiplier = match[2]
    ? 1024 ** ('KMG'.indexOf(match[2].toUpperCase()) + 1)
    : 1;
  const result = Number.parseInt(match[1], base) * multiplier;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(
      `Embedded Build Analyzer: MEMORY region "${region}" has invalid ${field} `
      + `literal "${value}".`
    );
  }
  return result;
}

function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function readText(filePath: string, label: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Embedded Build Analyzer: cannot read ${label} "${filePath}": ${message}`
    );
  }
}
