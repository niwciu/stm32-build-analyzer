import { MapFileAdapter } from '../map/MapFileAdapter';
import { IarMapParser } from './IarMapParser';

export interface IarAdapterDependencies {
  readonly mapParser?: IarMapParser;
}

/** IAR ILINK adapter using its self-contained text MAP report. */
export class IarAdapter extends MapFileAdapter {
  readonly toolchainId = 'iar-arm' as const;
  protected readonly definition;

  constructor(dependencies: IarAdapterDependencies = {}) {
    super();
    this.definition = {
      displayName: 'IAR Embedded Workbench for Arm',
      targetArchitecture: 'Arm ELF/DWARF',
      parser: dependencies.mapParser ?? new IarMapParser(),
    };
  }
}
