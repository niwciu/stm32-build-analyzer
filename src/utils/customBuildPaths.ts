export function assertCustomBuildPairComplete(
  mapFilePath?: string,
  elfFilePath?: string
): void {
  if (Boolean(mapFilePath) !== Boolean(elfFilePath)) {
    throw new Error(
      'STM32 Build Analyzer: mapFilePath and elfFilePath must be configured together '
      + 'or both left empty.'
    );
  }
}
