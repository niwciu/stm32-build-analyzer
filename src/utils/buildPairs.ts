export interface BuildOutputNamePair {
  map: string;
  elf: string;
  stem: string;
}

function outputStem(fileName: string, extension: '.map' | '.elf'): string | undefined {
  if (!fileName.toLowerCase().endsWith(extension)) {
    return undefined;
  }
  return fileName.slice(0, -extension.length);
}

export function pairBuildOutputNames(fileNames: readonly string[]): BuildOutputNamePair[] {
  const maps = new Map<string, { name: string; stem: string }>();
  const elfs = new Map<string, string>();

  [...fileNames].sort((a, b) => a.localeCompare(b)).forEach(fileName => {
    const mapStem = outputStem(fileName, '.map');
    if (mapStem !== undefined) {
      maps.set(mapStem.toLowerCase(), { name: fileName, stem: mapStem });
      return;
    }

    const elfStem = outputStem(fileName, '.elf');
    if (elfStem !== undefined) {
      elfs.set(elfStem.toLowerCase(), fileName);
    }
  });

  return [...maps.entries()]
    .flatMap(([normalizedStem, map]) => {
      const elf = elfs.get(normalizedStem);
      return elf ? [{ map: map.name, elf, stem: map.stem }] : [];
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
