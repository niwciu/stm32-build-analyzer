import type {
  KnownToolchainId,
  ToolchainAdapter,
} from './contracts';
import {
  GnuArmAdapter,
  GnuArmAdapterDependencies,
} from '../toolchains/gnu-arm/GnuArmAdapter';

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
  dependencies: GnuArmAdapterDependencies = {}
): AdapterRegistry {
  return new AdapterRegistry([
    new GnuArmAdapter(toolchainPath, debug, dependencies),
  ]);
}
