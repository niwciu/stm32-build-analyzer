import {
  GnuBinutilsAdapter,
  GnuBinutilsAdapterDefinition,
  GnuBinutilsAdapterDependencies,
} from '../toolchains/gnu/GnuBinutilsAdapter';
import { defineGnuAdapterContract } from './contracts/gnuAdapterContract';

const TEST_DEFINITION: GnuBinutilsAdapterDefinition = {
  displayName: 'Test GNU Target',
  targetArchitecture: 'test-architecture',
  objdumpTool: 'test-target-objdump',
  nmTool: 'test-target-nm',
  logLabel: 'Test GNU Adapter',
  temporaryDirectoryPrefix: 'gnu-contract-adapter-',
};

class TestGnuBinutilsAdapter extends GnuBinutilsAdapter {
  readonly toolchainId = 'gnu-riscv-none-elf' as const;
  protected readonly definition = TEST_DEFINITION;

  constructor(dependencies: GnuBinutilsAdapterDependencies) {
    super('', false, dependencies);
  }
}

defineGnuAdapterContract({
  name: 'shared GNU/binutils adapter contract (alternate configuration)',
  toolchainId: 'gnu-riscv-none-elf',
  displayName: TEST_DEFINITION.displayName,
  targetArchitecture: TEST_DEFINITION.targetArchitecture,
  objdumpTool: TEST_DEFINITION.objdumpTool,
  nmTool: TEST_DEFINITION.nmTool,
  createAdapter: (toolRunner, toolResolver) => new TestGnuBinutilsAdapter({
    toolRunner,
    toolResolver,
  }),
});
