import {
  GnuBinutilsAdapter,
  GnuBinutilsAdapterDefinition,
  GnuBinutilsAdapterDependencies,
} from '../gnu/GnuBinutilsAdapter';
import { discoverGnuToolPrefix } from '../gnu/GnuToolPrefixDiscovery';

/** Verified Espressif GNU Xtensa tool prefixes, newest unified prefix first. */
export const GNU_XTENSA_TOOL_PREFIXES = [
  'xtensa-esp-elf-',
  'xtensa-esp32-elf-',
  'xtensa-esp32s2-elf-',
  'xtensa-esp32s3-elf-',
] as const;

export type GnuXtensaToolPrefix = typeof GNU_XTENSA_TOOL_PREFIXES[number];

export interface GnuXtensaAdapterDependencies
  extends GnuBinutilsAdapterDependencies {
  readonly toolPrefix?: GnuXtensaToolPrefix;
}

/** Concrete GNU Xtensa adapter for verified Espressif ESP32 targets. */
export class GnuXtensaAdapter extends GnuBinutilsAdapter {
  readonly toolchainId = 'gnu-xtensa-elf' as const;
  protected readonly definition: GnuBinutilsAdapterDefinition;

  constructor(
    toolchainPath: string,
    debug: boolean = false,
    dependencies: GnuXtensaAdapterDependencies = {}
  ) {
    const prefix = dependencies.toolPrefix ?? discoverGnuToolPrefix(
      GNU_XTENSA_TOOL_PREFIXES,
      toolchainPath
    );
    super(toolchainPath, debug, dependencies);
    this.definition = {
      displayName: 'GNU Xtensa Embedded',
      targetArchitecture: 'Xtensa / ESP32',
      objdumpTool: `${prefix}objdump`,
      nmTool: `${prefix}nm`,
      logLabel: 'GNU Xtensa Adapter',
      temporaryDirectoryPrefix: 'embedded-build-analyzer-xtensa-',
    };
  }
}
