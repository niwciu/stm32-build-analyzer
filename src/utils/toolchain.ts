import * as fs from 'fs';
import * as path from 'path';
import { getToolFilename } from '../process/ToolResolver';

export { getToolFilename };

export const ARM_TOOLCHAIN_TOOLS = [
  'arm-none-eabi-objdump',
  'arm-none-eabi-nm',
] as const;

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
