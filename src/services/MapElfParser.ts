import type { AnalyzedMemoryRegion } from '../analysis/contracts';
import type { Region } from '../models';
import type { ToolRunner } from '../process/ToolRunner';
import {
  ConfiguredDirectoryToolResolver,
  ToolResolver,
} from '../process/ToolResolver';
import {
  GnuArmAdapter,
  ToolExecutionError,
} from '../toolchains/gnu-arm/GnuArmAdapter';

export { ToolExecutionError };

/**
 * Compatibility facade for the provider's legacy Region[] contract.
 * GNU parsing and tool execution live in GnuArmAdapter and its collaborators.
 */
export class MapElfParser {
  private readonly adapter: GnuArmAdapter;
  private analysisWarnings: string[] = [];

  constructor(
    toolchainPath: string,
    debug: boolean = false,
    toolRunner?: ToolRunner,
    toolResolver: ToolResolver = new ConfiguredDirectoryToolResolver(toolchainPath)
  ) {
    this.adapter = new GnuArmAdapter(toolchainPath, debug, {
      toolRunner,
      toolResolver,
    });
  }

  get warnings(): readonly string[] {
    return this.analysisWarnings;
  }

  async parse(
    mapPath: string,
    elfPath: string,
    signal?: AbortSignal
  ): Promise<Region[]> {
    this.analysisWarnings = [];
    const analysis = await this.adapter.analyze({
      mapPath,
      executablePath: elfPath,
      linkerScriptPaths: [],
    }, signal);
    this.analysisWarnings = analysis.warnings.map(warning => warning.message);
    return analysis.regions.map(toLegacyRegion);
  }
}

function toLegacyRegion(region: AnalyzedMemoryRegion): Region {
  return {
    name: region.name,
    startAddress: region.startAddress,
    size: region.size,
    used: region.used ?? 0,
    sections: region.sections.map(section => ({
      name: section.name,
      startAddress: section.startAddress,
      size: section.size,
      loadAddress: section.loadAddress ?? 0,
      symbols: section.symbols.map(symbol => ({
        name: symbol.name,
        startAddress: symbol.startAddress,
        size: symbol.size ?? 0,
        path: symbol.source?.path ?? '',
        row: symbol.source?.line ?? 0,
      })),
    })),
  };
}
