export interface SymbolEntry {
    name: string;
    startAddress: number;
    size: number;
    path: string;
    row: number;
  }
  
  export interface Section {
    name: string;
    startAddress: number;
    size: number;
    loadAddress: number;
    symbols: SymbolEntry[];
  }
  
  export interface Region {
    name: string;
    startAddress: number;
    size: number;
    used: number;
    sections: Section[];
  }
  