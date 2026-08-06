import * as fs from 'fs';
import * as path from 'path';
import { pairBuildOutputNames } from './buildPairs';

export interface DiscoveredBuildPair {
  folder: string;
  map: string;
  elf: string;
  label: string;
}

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.vscode',
  '.vscode-test',
  'dist',
  'out',
]);

export async function discoverBuildPairs(
  root: string,
  ignoredDirectories: ReadonlySet<string> = DEFAULT_IGNORED_DIRECTORIES
): Promise<DiscoveredBuildPair[]> {
  const found: DiscoveredBuildPair[] = [];
  const visited = new Set<string>();

  const walk = async (directory: string): Promise<void> => {
    let realPath: string;
    let entries: fs.Dirent[];
    try {
      realPath = await fs.promises.realpath(directory);
      if (visited.has(realPath)) {
        return;
      }
      visited.add(realPath);
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (
        entry.isDirectory()
        && !entry.isSymbolicLink()
        && !ignoredDirectories.has(entry.name)
      ) {
        await walk(path.join(directory, entry.name));
      }
    }

    const files = entries.filter(entry => entry.isFile()).map(entry => entry.name);
    for (const pair of pairBuildOutputNames(files)) {
      const mapFile = path.join(directory, pair.map);
      const elfFile = path.join(directory, pair.elf);
      try {
        const [mapStats] = await Promise.all([
          fs.promises.stat(mapFile),
          fs.promises.access(mapFile, fs.constants.R_OK),
          fs.promises.access(elfFile, fs.constants.R_OK),
        ]);
        if (mapStats.size === 0) {
          continue;
        }
        found.push({
          folder: directory,
          map: mapFile,
          elf: elfFile,
          label: pair.stem,
        });
      } catch {
        // Ignore build outputs that disappear or become inaccessible during discovery.
      }
    }
  };

  await walk(root);

  return found.sort((a, b) =>
    a.folder.localeCompare(b.folder) || a.label.localeCompare(b.label)
  );
}

export async function discoverBuildPairsInRoots(
  roots: readonly string[]
): Promise<DiscoveredBuildPair[]> {
  const perRoot = await Promise.all(roots.map(root => discoverBuildPairs(root)));
  const unique = new Map<string, DiscoveredBuildPair>();

  perRoot.flat().forEach(pair => {
    const key = `${path.normalize(pair.map)}\0${path.normalize(pair.elf)}`;
    unique.set(key, pair);
  });

  return [...unique.values()].sort((a, b) =>
    a.folder.localeCompare(b.folder) || a.label.localeCompare(b.label)
  );
}
