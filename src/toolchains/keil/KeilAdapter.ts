import { MapFileAdapter } from '../map/MapFileAdapter';
import { KeilMapParser } from './KeilMapParser';

export interface KeilAdapterDependencies {
  readonly mapParser?: KeilMapParser;
}

/** Arm Compiler armlink adapter using its self-contained text MAP report. */
export class KeilAdapter extends MapFileAdapter {
  readonly toolchainId = 'keil-armclang' as const;
  protected readonly definition;

  constructor(dependencies: KeilAdapterDependencies = {}) {
    super();
    this.definition = {
      displayName: 'Keil/Arm Compiler',
      targetArchitecture: 'Arm ELF/AXF',
      parser: dependencies.mapParser ?? new KeilMapParser(),
    };
  }
}
