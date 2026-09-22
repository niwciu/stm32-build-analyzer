import * as path from 'path';

export interface BuildOutputNamePair {
  map: string;
  elf: string;
  stem: string;
}

export interface BuildOutputPaths {
  map: string;
  elf: string;
}

const EXECUTABLE_EXTENSIONS = ['.elf', '.axf', '.out'] as const;

function outputStem(fileName: string, extension: string): string | undefined {
  if (!fileName.toLowerCase().endsWith(extension)) {
    return undefined;
  }
  return fileName.slice(0, -extension.length);
}

export function pairBuildOutputNames(fileNames: readonly string[]): BuildOutputNamePair[] {
  const maps = new Map<string, { name: string; stem: string }>();
  const executables = new Map<string, { name: string; priority: number }>();

  [...fileNames].sort((a, b) => a.localeCompare(b)).forEach(fileName => {
    const mapStem = outputStem(fileName, '.map');
    if (mapStem !== undefined) {
      maps.set(mapStem.toLowerCase(), { name: fileName, stem: mapStem });
      return;
    }

    for (const [priority, extension] of EXECUTABLE_EXTENSIONS.entries()) {
      const executableStem = outputStem(fileName, extension);
      if (executableStem === undefined) {
        continue;
      }
      const normalizedStem = executableStem.toLowerCase();
      const previous = executables.get(normalizedStem);
      if (!previous || priority < previous.priority) {
        executables.set(normalizedStem, { name: fileName, priority });
      }
      break;
    }
  });

  return [...maps.entries()]
    .flatMap(([normalizedStem, map]) => {
      const executable = executables.get(normalizedStem)?.name;
      return executable
        ? [{ map: map.name, elf: executable, stem: map.stem }]
        : [];
    })
    .sort((a, b) => {
      const priority = (stem: string): number => {
        const normalized = stem.toLowerCase();
        if (normalized.includes('release')) {return 0;}
        if (normalized.includes('debug')) {return 1;}
        return 2;
      };
      return priority(a.stem) - priority(b.stem) || a.stem.localeCompare(b.stem);
    });
}

export function findPreferredBuildOutput<T extends BuildOutputPaths>(
  candidates: readonly T[],
  preferred?: BuildOutputPaths,
  platform: NodeJS.Platform = process.platform
): T | undefined {
  if (!preferred) {
    return undefined;
  }

  const normalize = (value: string): string => {
    const normalized = platform === 'win32'
      ? path.win32.normalize(value)
      : path.normalize(value);
    return platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const preferredMap = normalize(preferred.map);
  const preferredElf = normalize(preferred.elf);

  return candidates.find(candidate =>
    normalize(candidate.map) === preferredMap
    && normalize(candidate.elf) === preferredElf
  );
}
