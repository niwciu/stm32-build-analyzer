import * as fs from 'fs';
import * as path from 'path';

const LINKER_SCRIPT_EXTENSIONS = new Set(['.ld', '.lds', '.ldscript']);
const MEMORY_BLOCK = /\bMEMORY\b[^{}]*\{/;

/**
 * Finds one unambiguous linker script near the selected build outputs.
 *
 * The search is deliberately shallow at each directory level and never leaves
 * the workspace. This avoids guessing between unrelated target scripts in a
 * source tree while still covering generated scripts placed beside build
 * outputs and the common single-script project layout.
 */
export async function discoverLinkerScriptPaths(
  mapPath: string,
  executablePath: string,
  workspaceFolder: string
): Promise<readonly string[]> {
  const workspaceRoot = path.resolve(workspaceFolder);
  let directories = uniquePaths([
    path.dirname(path.resolve(mapPath)),
    path.dirname(path.resolve(executablePath)),
  ]).filter(directory => isWithin(directory, workspaceRoot));
  const artifactStems = new Set([
    path.basename(mapPath, path.extname(mapPath)).toLowerCase(),
    path.basename(executablePath, path.extname(executablePath)).toLowerCase(),
  ]);
  const visited = new Set<string>();

  while (directories.length > 0) {
    const candidates = await findMemoryScripts(directories);
    const matching = candidates.filter(candidate =>
      artifactStems.has(path.basename(candidate, path.extname(candidate)).toLowerCase())
    );

    if (matching.length === 1) {
      return matching;
    }
    if (matching.length > 1) {
      return [];
    }
    if (candidates.length === 1) {
      return candidates;
    }
    if (candidates.length > 1) {
      return [];
    }

    directories.forEach(directory => visited.add(normalizeForComparison(directory)));
    directories = uniquePaths(
      directories
        .filter(directory => normalizeForComparison(directory) !== normalizeForComparison(workspaceRoot))
        .map(directory => path.dirname(directory))
    ).filter(directory =>
      isWithin(directory, workspaceRoot)
      && !visited.has(normalizeForComparison(directory))
    );
  }

  return [];
}

async function findMemoryScripts(
  directories: readonly string[]
): Promise<string[]> {
  const results: string[] = [];

  for (const directory of directories) {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    const scriptPaths = entries
      .filter(entry =>
        entry.isFile()
        && LINKER_SCRIPT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      )
      .map(entry => path.join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right));

    for (const scriptPath of scriptPaths) {
      try {
        const contents = await fs.promises.readFile(scriptPath, 'utf8');
        const uncommented = contents
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        if (MEMORY_BLOCK.test(uncommented)) {
          results.push(scriptPath);
        }
      } catch {
        // An inaccessible candidate is not usable as an analysis artifact.
      }
    }
  }

  return uniquePaths(results).sort((left, right) => left.localeCompare(right));
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function uniquePaths(paths: readonly string[]): string[] {
  const byNormalizedPath = new Map<string, string>();
  for (const value of paths) {
    byNormalizedPath.set(normalizeForComparison(value), value);
  }
  return [...byNormalizedPath.values()];
}

function normalizeForComparison(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
