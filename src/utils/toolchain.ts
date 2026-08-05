import * as fs from 'fs';
import * as path from 'path';

export const ARM_TOOLCHAIN_TOOLS = [
  'arm-none-eabi-objdump',
  'arm-none-eabi-nm',
] as const;

export function getToolFilename(tool: string, platform: NodeJS.Platform = process.platform): string {
  return tool + (platform === 'win32' ? '.exe' : '');
}

export async function findMissingToolchainBinaries(
  toolchainPath: string,
  platform: NodeJS.Platform = process.platform
): Promise<string[]> {
  const missing: string[] = [];

  for (const tool of ARM_TOOLCHAIN_TOOLS) {
    const filename = getToolFilename(tool, platform);
    try {
      await fs.promises.access(path.join(toolchainPath, filename), fs.constants.R_OK);
    } catch {
      missing.push(filename);
    }
  }

  return missing;
}
