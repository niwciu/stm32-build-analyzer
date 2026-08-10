import * as path from 'path';

export function normalizeWatchedFile(
  filePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  const normalized = path.normalize(filePath);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function isSelectedBuildFile(
  eventPath: string,
  selectedPaths: ReadonlySet<string>,
  platform: NodeJS.Platform = process.platform
): boolean {
  return selectedPaths.has(normalizeWatchedFile(eventPath, platform));
}
