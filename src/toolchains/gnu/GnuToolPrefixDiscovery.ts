import * as fs from 'fs';
import * as path from 'path';
import { getToolFilename } from '../../process/ToolResolver';

export interface GnuToolPrefixDiscoveryOptions {
  readonly pathValue?: string;
  readonly platform?: NodeJS.Platform;
  readonly isExecutableFile?: (candidate: string) => boolean;
}

/** Selects a prefix with configured-directory precedence, then searches PATH. */
export function discoverGnuToolPrefix<T extends string>(
  prefixes: readonly T[],
  configuredDirectory: string,
  options: GnuToolPrefixDiscoveryOptions = {}
): T {
  if (prefixes.length === 0) {
    throw new Error('At least one GNU tool prefix is required.');
  }

  const platform = options.platform ?? process.platform;
  const isExecutableFile = options.isExecutableFile ?? isRegularFile;
  if (configuredDirectory) {
    const configured = findPrefixInDirectory(
      prefixes,
      configuredDirectory,
      platform,
      isExecutableFile
    );
    if (configured) {
      return configured;
    }
  }

  const pathValue = options.pathValue ?? process.env.PATH ?? '';
  const delimiter = platform === 'win32' ? path.win32.delimiter : path.posix.delimiter;
  for (const entry of pathValue.split(delimiter)) {
    const directory = unquote(entry.trim());
    if (!directory) {
      continue;
    }
    const discovered = findPrefixInDirectory(
      prefixes,
      directory,
      platform,
      isExecutableFile
    );
    if (discovered) {
      return discovered;
    }
  }

  return prefixes[0];
}

function findPrefixInDirectory<T extends string>(
  prefixes: readonly T[],
  directory: string,
  platform: NodeJS.Platform,
  isExecutableFile: (candidate: string) => boolean
): T | undefined {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  return prefixes.find(prefix => isExecutableFile(pathApi.join(
    directory,
    getToolFilename(`${prefix}objdump`, platform)
  )));
}

function isRegularFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}
