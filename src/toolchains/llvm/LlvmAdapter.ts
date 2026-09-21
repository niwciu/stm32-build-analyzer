import {
  GnuBinutilsAdapter,
  GnuBinutilsAdapterDefinition,
  GnuBinutilsAdapterDependencies,
} from '../gnu/GnuBinutilsAdapter';
import { LlvmLldMapParser } from './LlvmLldMapParser';
import { LlvmObjectParser } from './LlvmObjectParser';

export type LlvmAdapterDependencies = GnuBinutilsAdapterDependencies;

/** LLVM ELF adapter for native LLD MAP and LLVM object-tool output. */
export class LlvmAdapter extends GnuBinutilsAdapter {
  readonly toolchainId = 'llvm' as const;
  protected readonly definition: GnuBinutilsAdapterDefinition = {
    displayName: 'LLVM/Clang Embedded',
    targetArchitecture: 'LLVM ELF target',
    objdumpTool: 'llvm-objdump',
    nmTool: 'llvm-nm',
    logLabel: 'LLVM Adapter',
    temporaryDirectoryPrefix: 'embedded-build-analyzer-llvm-',
  };

  constructor(
    toolchainPath: string,
    debug: boolean = false,
    dependencies: LlvmAdapterDependencies = {}
  ) {
    super(toolchainPath, debug, {
      ...dependencies,
      mapParser: dependencies.mapParser ?? new LlvmLldMapParser(),
      binutilsParser: dependencies.binutilsParser ?? new LlvmObjectParser(debug),
    });
  }
}
