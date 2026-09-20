import {
  GnuBinutilsAdapter,
  GnuBinutilsAdapterDefinition,
  GnuBinutilsAdapterDependencies,
} from '../gnu/GnuBinutilsAdapter';

export type GnuArmAdapterDependencies = GnuBinutilsAdapterDependencies;

const GNU_ARM_DEFINITION: GnuBinutilsAdapterDefinition = {
  displayName: 'GNU Arm Embedded',
  targetArchitecture: 'Arm',
  objdumpTool: 'arm-none-eabi-objdump',
  nmTool: 'arm-none-eabi-nm',
  logLabel: 'GNU Arm Adapter',
  temporaryDirectoryPrefix: 'stm32-build-analyzer-',
};

/** Concrete GNU Arm adapter backed by the shared GNU/binutils workflow. */
export class GnuArmAdapter extends GnuBinutilsAdapter {
  readonly toolchainId = 'gnu-arm-none-eabi' as const;
  protected readonly definition = GNU_ARM_DEFINITION;

  constructor(
    toolchainPath: string,
    debug: boolean = false,
    dependencies: GnuArmAdapterDependencies = {}
  ) {
    super(toolchainPath, debug, dependencies);
  }
}
