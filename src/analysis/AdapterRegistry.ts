import type {
  KnownToolchainId,
  ToolchainAdapter,
} from './contracts';
import {
  GnuArmAdapter,
  GnuArmAdapterDependencies,
} from '../toolchains/gnu-arm/GnuArmAdapter';
import {
  GnuRiscVAdapter,
  GnuRiscVAdapterDependencies,
} from '../toolchains/gnu-riscv/GnuRiscVAdapter';
import {
  GnuXtensaAdapter,
  GnuXtensaAdapterDependencies,
} from '../toolchains/gnu-xtensa/GnuXtensaAdapter';
import {
  LlvmAdapter,
  LlvmAdapterDependencies,
} from '../toolchains/llvm/LlvmAdapter';
import {
  KeilAdapter,
  KeilAdapterDependencies,
} from '../toolchains/keil/KeilAdapter';
import {
  IarAdapter,
  IarAdapterDependencies,
} from '../toolchains/iar/IarAdapter';

export interface DefaultAdapterRegistryDependencies {
  readonly gnuArm?: GnuArmAdapterDependencies;
  readonly gnuRiscV?: GnuRiscVAdapterDependencies;
  readonly gnuXtensa?: GnuXtensaAdapterDependencies;
  readonly llvm?: LlvmAdapterDependencies;
  readonly keil?: KeilAdapterDependencies;
  readonly iar?: IarAdapterDependencies;
}

export class AdapterRegistry {
  private readonly adapters = new Map<KnownToolchainId, ToolchainAdapter>();

  constructor(adapters: readonly ToolchainAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.toolchainId)) {
        throw new Error(`Duplicate adapter for ${adapter.toolchainId}.`);
      }
      this.adapters.set(adapter.toolchainId, adapter);
    }
  }

  get(toolchainId: KnownToolchainId): ToolchainAdapter | undefined {
    return this.adapters.get(toolchainId);
  }

  has(toolchainId: KnownToolchainId): boolean {
    return this.adapters.has(toolchainId);
  }

  get toolchainIds(): readonly KnownToolchainId[] {
    return [...this.adapters.keys()].sort((left, right) =>
      left.localeCompare(right)
    );
  }
}

export function createDefaultAdapterRegistry(
  toolchainPath: string,
  debug: boolean = false,
  dependencies: DefaultAdapterRegistryDependencies = {}
): AdapterRegistry {
  return new AdapterRegistry([
    new GnuArmAdapter(toolchainPath, debug, dependencies.gnuArm),
    new GnuRiscVAdapter(toolchainPath, debug, dependencies.gnuRiscV),
    new GnuXtensaAdapter(toolchainPath, debug, dependencies.gnuXtensa),
    new LlvmAdapter(toolchainPath, debug, dependencies.llvm),
    new KeilAdapter(dependencies.keil),
    new IarAdapter(dependencies.iar),
  ]);
}
