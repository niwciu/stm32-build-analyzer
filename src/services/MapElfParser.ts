import * as cp from 'child_process';
import * as fs from 'fs';
import { Region, Section, SymbolEntry } from '../models';

export class MapElfParser {
  constructor(
    private readonly toolchainPath: string,
    private readonly debug: boolean = false
  ) {}

  public parse(mapPath: string, elfPath: string): Region[] {
    if (this.debug) {
      console.log(`[STM32 Parser] Parsing map: ${mapPath}`);
      console.log(`[STM32 Parser] Parsing elf: ${elfPath}`);
    }

    const regions = this.parseMap(mapPath);

    if (this.debug) {
      console.log(`[STM32 Parser] Regions parsed: ${regions.length}`);
      regions.forEach(r =>
        console.log(` → ${r.name}: ${r.size.toString(16)} bytes at 0x${r.startAddress.toString(16)}`)
      );
    }

    this.parseSections(elfPath, regions);
    this.parseSymbols(elfPath, regions);

    return regions;
  }

  private parseMap(mapFile: string): Region[] {
    const lines = fs.readFileSync(mapFile, 'utf8').split('\n');
    const regs: Region[] = [];
    const regionRx = /^\s*(\w+)\s+(0x[\da-fA-F]+)\s+(0x[\da-fA-F]+)/;
    let inMem = false;

    for (const l of lines) {
      if (l.startsWith('Memory Configuration')) { inMem = true; continue; }
      if (l.startsWith('Linker script and memory map')) { break; }
      if (!inMem) { continue; }

      const m = regionRx.exec(l);
      if (m) {
        regs.push({
          name: m[1],
          startAddress: parseInt(m[2], 16),
          size: parseInt(m[3], 16),
          used: 0,
          sections: []
        });
      }
    }

    return regs;
  }

  private parseSections(elfFile: string, regions: Region[]): void {
    const cmd = this.getTool('arm-none-eabi-objdump');
    const out = cp.spawnSync(cmd, ['-h', elfFile]);

    if (out.error) {
      if (this.debug) {console.error(`[STM32 Parser] objdump error: ${out.error.message}`);}
      return;
    }

    const lines = out.stdout.toString().split('\n');
    const secRx = /^\s*\d+\s+([\.\w]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)/;
    const allocRx = /\bALLOC\b/;
    let prev = '';

    for (const l of lines) {
      if (!allocRx.test(l)) { prev = l; continue; }
      const m = secRx.exec(prev);
      if (!m) { continue; }

      const name = m[1],
        size = parseInt(m[2], 16),
        addr = parseInt(m[3], 16),
        load = parseInt(m[4], 16);
      if (size === 0) { continue; }

      for (const r of regions) {
        const rs = r.startAddress, re = rs + r.size;
        if (addr >= rs && addr < re || (load >= rs && load < re && name === '.data')) {
          r.sections.push({ name, startAddress: addr, size, loadAddress: load, symbols: [] });
          r.used += size;
          if (this.debug) {
            console.log(`[STM32 Parser] Section ${name} assigned to region ${r.name}`);
          }
        }
      }
    }
  }

  private parseSymbols(elfFile: string, regions: Region[]): void {
    const cmd = this.getTool('arm-none-eabi-nm');
    const out = cp.spawnSync(cmd, ['-C', '-S', '-n', '-l', '--defined-only', elfFile]);

    if (out.error) {
      if (this.debug) {console.error(`[STM32 Parser] nm error: ${out.error.message}`);}
      return;
    }

    const lines = out.stdout.toString().split('\n');
    const symRx = /^([0-9A-Fa-f]+)\s+([0-9A-Fa-f]+)?\s*\w\s+(\S+)\s*(\S*)/;
    const pathRx = /(.*):(\d+)$/;

    for (const l of lines) {
      const m = symRx.exec(l);
      if (!m) { continue; }

      const addr = parseInt(m[1], 16),
        size = isNaN(parseInt(m[2] || '0', 16)) ? 0 : parseInt(m[2]!, 16),
        name = m[3],
        raw = m[4] || '';
      let file = '', row = 0;

      const pm = pathRx.exec(raw);
      if (pm) {
        file = pm[1];
        row = parseInt(pm[2], 10);
      }

      for (const r of regions) {
        const rs = r.startAddress, re = rs + r.size;
        if (addr < rs || addr >= re) { continue; }

        for (const s of r.sections) {
          const ss = s.startAddress, se = ss + s.size;
          if (addr >= ss && addr < se) {
            s.symbols.push({ name, startAddress: addr, size, path: file, row });
            if (this.debug) {
              console.log(`[STM32 Parser] Symbol ${name} in section ${s.name} (${file}:${row})`);
            }
            break;
          }
        }
      }
    }
  }

  private getTool(exe: string): string {
    const full = `${this.toolchainPath}/${exe}${process.platform === 'win32' ? '.exe' : ''}`;
    if (this.toolchainPath && fs.existsSync(full)) {
      if (this.debug) {console.log(`[STM32 Parser] Using tool: ${full}`);}
      return full;
    }

    if (this.debug) {console.warn(`[STM32 Parser] Falling back to ${exe} from PATH`);}
    return exe;
  }
}
