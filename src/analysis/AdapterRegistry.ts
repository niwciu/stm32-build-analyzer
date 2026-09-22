import type {
  KnownToolchainId,
  ToolchainAdapter,
} from './contracts';
import {
  assertSupportedAdapterContribution,
  defineToolchainAdapterV1,
  ToolchainAdapterContribution,
} from './adapterApi';
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

  static fromContributions(
    contributions: readonly ToolchainAdapterContribution[]
  ): AdapterRegistry {
    for (const contribution of contributions) {
      assertSupportedAdapterContribution(contribution);
    }
    return new AdapterRegistry(contributions.map(({ adapter }) => adapter));
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
  return AdapterRegistry.fromContributions(
    createDefaultAdapterContributions(toolchainPath, debug, dependencies)
  );
}

export function createDefaultAdapterContributions(
  toolchainPath: string,
  debug: boolean = false,
  dependencies: DefaultAdapterRegistryDependencies = {}
): readonly ToolchainAdapterContribution[] {
  return [
    defineToolchainAdapterV1(
      new GnuArmAdapter(toolchainPath, debug, dependencies.gnuArm)
    ),
    defineToolchainAdapterV1(
      new GnuRiscVAdapter(toolchainPath, debug, dependencies.gnuRiscV)
    ),
    defineToolchainAdapterV1(
      new GnuXtensaAdapter(toolchainPath, debug, dependencies.gnuXtensa)
    ),
    defineToolchainAdapterV1(
      new LlvmAdapter(toolchainPath, debug, dependencies.llvm)
    ),
    defineToolchainAdapterV1(new KeilAdapter(dependencies.keil)),
    defineToolchainAdapterV1(new IarAdapter(dependencies.iar)),
  ];
}
