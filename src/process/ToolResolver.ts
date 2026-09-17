import * as fs from 'fs';
import * as path from 'path';

export type ToolResolutionSource = 'configured-directory' | 'path';

export interface ToolResolution {
  readonly command: string;
  readonly source: ToolResolutionSource;
  readonly configuredCandidate?: string;
}

export interface ToolResolver {
  resolve(tool: string): ToolResolution;
}

export type ToolPathExists = (candidate: string) => boolean;

export function getToolFilename(
  tool: string,
  platform: NodeJS.Platform = process.platform
): string {
  return tool + (platform === 'win32' ? '.exe' : '');
}

/** Prefers an existing configured binary and otherwise lets PATH resolve it. */
export class ConfiguredDirectoryToolResolver implements ToolResolver {
  constructor(
    private readonly configuredDirectory: string,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly pathExists: ToolPathExists = fs.existsSync
  ) {}

  resolve(tool: string): ToolResolution {
    if (this.configuredDirectory) {
      const configuredCandidate = path.join(
        this.configuredDirectory,
        getToolFilename(tool, this.platform)
      );
      if (this.pathExists(configuredCandidate)) {
        return {
          command: configuredCandidate,
          source: 'configured-directory',
          configuredCandidate,
        };
      }
      return {
        command: tool,
        source: 'path',
        configuredCandidate,
      };
    }

    return { command: tool, source: 'path' };
  }
}
