import {
  GnuBinutilsAdapter,
  GnuBinutilsAdapterDefinition,
  GnuBinutilsAdapterDependencies,
} from '../gnu/GnuBinutilsAdapter';
import { discoverGnuToolPrefix } from '../gnu/GnuToolPrefixDiscovery';

export const GNU_RISCV_TOOL_PREFIXES = [
  'riscv64-unknown-elf-',
  'riscv32-unknown-elf-',
  'riscv64-none-elf-',
  'riscv32-none-elf-',
  'riscv-none-elf-',
] as const;

export type GnuRiscVToolPrefix = typeof GNU_RISCV_TOOL_PREFIXES[number];

export interface GnuRiscVAdapterDependencies
  extends GnuBinutilsAdapterDependencies {
  readonly toolPrefix?: GnuRiscVToolPrefix;
}

/** Concrete bare-metal GNU RISC-V adapter. */
export class GnuRiscVAdapter extends GnuBinutilsAdapter {
  readonly toolchainId = 'gnu-riscv-none-elf' as const;
  protected readonly definition: GnuBinutilsAdapterDefinition;

  constructor(
    toolchainPath: string,
    debug: boolean = false,
    dependencies: GnuRiscVAdapterDependencies = {}
  ) {
    const prefix = dependencies.toolPrefix ?? discoverGnuToolPrefix(
      GNU_RISCV_TOOL_PREFIXES,
      toolchainPath
    );
    super(toolchainPath, debug, dependencies);
    this.definition = {
      displayName: 'GNU RISC-V Embedded',
      targetArchitecture: 'RISC-V',
      objdumpTool: `${prefix}objdump`,
      nmTool: `${prefix}nm`,
      logLabel: 'GNU RISC-V Adapter',
      temporaryDirectoryPrefix: 'embedded-build-analyzer-riscv-',
    };
  }
}
