import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

    // Analyze a throwaway copy of the ELF instead of the build's own output.
    // arm-none-eabi-objdump/nm open the ELF without FILE_SHARE_DELETE on
    // Windows, so reading the live file blocks the next build from
    // deleting/overwriting it (issue #11). Working on a copy keeps the
    // original handle-free; if the copy cannot be made we fall back to the
    // original so analysis still works (e.g. POSIX, where this is harmless).
    this.withElfCopy(elfPath, safeElf => {
      this.parseSections(safeElf, regions);
      this.parseSymbols(safeElf, regions);
    });

    return regions;
  }

  /**
   * Runs `fn` against a temporary copy of the ELF, then removes the copy.
   * Falls back to the original path if the copy cannot be created so the
   * caller always gets a usable path. The copy is read via fs (libuv opens
   * with share-delete semantics), so even creating it never blocks a build.
   */
  private withElfCopy(elfPath: string, fn: (elf: string) => void): void {
    let tempDir: string | undefined;
    let elfForTools = elfPath;

    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stm32-build-analyzer-'));
      const dest = path.join(tempDir, path.basename(elfPath));
      // readFileSync + writeFileSync (not copyFileSync) guarantees the
      // original is only opened with libuv's share-delete flags.
      fs.writeFileSync(dest, fs.readFileSync(elfPath));
      elfForTools = dest;
      if (this.debug) {
        console.log(`[STM32 Parser] Analyzing ELF copy: ${dest}`);
      }
    } catch (err: any) {
      if (this.debug) {
        console.warn(`[STM32 Parser] Could not create ELF copy, using original: ${err?.message ?? err}`);
      }
      if (tempDir) {
        this.removeTempDir(tempDir);
        tempDir = undefined;
      }
      elfForTools = elfPath;
    }

    try {
      fn(elfForTools);
    } finally {
      if (tempDir) {
        this.removeTempDir(tempDir);
      }
    }
  }

  private removeTempDir(dir: string): void {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err: any) {
      if (this.debug) {
        console.warn(`[STM32 Parser] Failed to remove temp dir ${dir}: ${err?.message ?? err}`);
      }
    }
  }

  private parseMap(mapFile: string): Region[] {
    const lines = fs.readFileSync(mapFile, 'utf8').split('\n');
    const regs: Region[] = [];
    const regionRx = /^\s*(\S+)\s+(0x[\da-fA-F]+)\s+(0x[\da-fA-F]+)/;
    let inMem = false;

    for (const l of lines) {
      if (l.startsWith('Memory Configuration')) { inMem = true; continue; }
      if (l.startsWith('Linker script and memory map')) { break; }
      if (!inMem) { continue; }

      const m = regionRx.exec(l);
      if (m) {
        const name = m[1];
        if (this.isCatchAllRegion(name)) {
          if (this.debug) {
            console.log(`[STM32 Parser] Skipping catch-all region: ${name}`);
          }
          continue;
        }
        regs.push({
          name,
          startAddress: parseInt(m[2], 16),
          size: parseInt(m[3], 16),
          used: 0,
          sections: []
        });
      }
    }

    return regs;
  }

  private isCatchAllRegion(name: string): boolean {
    const normalized = name.toLowerCase();
    if (normalized.includes('default')) {
      return true;
    }
    if (normalized.includes('catch-all') || normalized.includes('catchall')) {
      return true;
    }
    if (name.startsWith('*') && name.endsWith('*')) {
      return true;
    }
    return false;
  }

  private parseSections(elfFile: string, regions: Region[]): void {
    const cmd = this.getTool('arm-none-eabi-objdump');
    const out = cp.spawnSync(cmd, ['-h', elfFile], { maxBuffer: 8 * 1024 * 1024 });

    if (out.error || out.status !== 0) {
      if (this.debug) {
        console.error(`[STM32 Parser] objdump error: ${out.error?.message ?? 'non-zero exit code'}`);
      }
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
    const out = cp.spawnSync(
      cmd,
      ['-C', '-S', '-n', '-l', '--defined-only', elfFile],
      { maxBuffer: 32 * 1024 * 1024 }
    );

    if (out.error || out.status !== 0) {
      if (this.debug) {console.error(`[STM32 Parser] nm error: ${out.error?.message ?? 'non-zero exit code'}`);}
      return;
    }

    const lines = out.stdout.toString().split('\n');
    const symRx = /^([0-9A-Fa-f]+)\s+([0-9A-Fa-f]+)?\s*\w\s+([^\t]*)\t*(\S*)/;
    const pathRx = /(.*):(\d+)$/;
    const unmatchedLines: string[] = [];

    for (const l of lines) {
      const m = symRx.exec(l);
      if (!m) {
        if (this.debug) {
          unmatchedLines.push(l);
        }
        continue;
      }

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

    if (this.debug && unmatchedLines.length > 0) {
      const maxUnmatched = 10;
      console.log(`[STM32 Parser] Unmatched nm lines: ${unmatchedLines.length}`);
      unmatchedLines.slice(0, maxUnmatched).forEach((line, i) => {
        console.log(`  ${i + 1}: "${line}"`);
      });
    }
  }

  private getTool(exe: string): string {
    const suffix = process.platform === 'win32' ? '.exe' : '';
    const full = path.join(this.toolchainPath, exe + suffix);
    if (this.toolchainPath && fs.existsSync(full)) {
      if (this.debug) {console.log(`[STM32 Parser] Using tool: ${full}`);}
      return full;
    }

    if (this.debug) {console.warn(`[STM32 Parser] Falling back to ${exe} from PATH`);}
    return exe;
  }
}
