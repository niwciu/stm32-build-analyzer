import * as path from 'path';

export function normalizeWatchedFile(
  filePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const normalized = pathApi.normalize(filePath);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function isSelectedBuildFile(
  eventPath: string,
  selectedPaths: ReadonlySet<string>,
  platform: NodeJS.Platform = process.platform
): boolean {
  return selectedPaths.has(normalizeWatchedFile(eventPath, platform));
}
