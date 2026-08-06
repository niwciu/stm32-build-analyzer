import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Region } from '../models';
import { getToolFilename } from '../utils/toolchain';
import { AnalysisCancelledError } from '../utils/errors';

export class ToolExecutionError extends Error {
  constructor(
    public readonly tool: string,
    public readonly command: string,
    message: string
  ) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

export type ToolRunner = (
  command: string,
  args: readonly string[],
  options: { maxBuffer: number; timeoutMs: number; signal?: AbortSignal }
) => Promise<ToolRunResult>;

export interface ToolRunResult {
  stdout: Buffer;
  stderr: Buffer;
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

const TOOL_TIMEOUT_MS = 30_000;

export function spawnTool(
  command: string,
  args: readonly string[],
  options: { maxBuffer: number; timeoutMs: number; signal?: AbortSignal }
): Promise<ToolRunResult> {
  return new Promise(resolve => {
    if (options.signal?.aborted) {
      resolve({
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        status: null,
        signal: null,
        error: new AnalysisCancelledError(),
      });
      return;
    }

    let child: cp.ChildProcess;
    try {
      child = cp.spawn(command, [...args], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        status: null,
        signal: null,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let completed = false;

    const finish = (result: ToolRunResult): void => {
      if (completed) {
        return;
      }
      completed = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      resolve(result);
    };

    const failAndKill = (error: Error): void => {
      child.kill();
      finish({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        status: null,
        signal: null,
        error,
      });
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutSize += chunk.length;
      if (stdoutSize > options.maxBuffer) {
        failAndKill(new Error(`stdout exceeded ${options.maxBuffer} bytes`));
        return;
      }
      stdout.push(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrSize += chunk.length;
      if (stderrSize > options.maxBuffer) {
        failAndKill(new Error(`stderr exceeded ${options.maxBuffer} bytes`));
        return;
      }
      stderr.push(chunk);
    });

    child.once('error', error => {
      finish({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        status: null,
        signal: null,
        error,
      });
    });

    child.once('close', (status, signal) => {
      finish({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        status,
        signal,
      });
    });

    const timeout = setTimeout(() => {
      failAndKill(new Error(`timed out after ${options.timeoutMs} ms`));
    }, options.timeoutMs);
    function abort(): void {
      failAndKill(new AnalysisCancelledError());
    }
    options.signal?.addEventListener('abort', abort, { once: true });
  });
}

export class MapElfParser {
  private analysisWarnings: string[] = [];

  constructor(
    private readonly toolchainPath: string,
    private readonly debug: boolean = false,
    private readonly toolRunner: ToolRunner = spawnTool
  ) {}

  public get warnings(): readonly string[] {
    return this.analysisWarnings;
  }

  public async parse(
    mapPath: string,
    elfPath: string,
    signal?: AbortSignal
  ): Promise<Region[]> {
    if (signal?.aborted) {
      throw new AnalysisCancelledError();
    }
    this.analysisWarnings = [];

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
    await this.withElfCopy(elfPath, async safeElf => {
      await this.parseSections(safeElf, regions, signal);
      try {
        await this.parseSymbols(safeElf, regions, path.dirname(elfPath), signal);
      } catch (err) {
        if (err instanceof ToolExecutionError && err.tool === 'arm-none-eabi-nm') {
          this.analysisWarnings.push(
            `${err.message} Memory usage is available, but symbol and source details are incomplete.`
          );
          return;
        }
        throw err;
      }
    });

    return regions;
  }

  /**
   * Runs `fn` against a temporary copy of the ELF, then removes the copy.
   * Falls back to the original path if the copy cannot be created so the
   * caller always gets a usable path. The copy is read via fs (libuv opens
   * with share-delete semantics), so even creating it never blocks a build.
   */
  private async withElfCopy(
    elfPath: string,
    fn: (elf: string) => Promise<void>
  ): Promise<void> {
    let tempDir: string | undefined;
    let elfForTools = elfPath;

    try {
      tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stm32-build-analyzer-'));
      const dest = path.join(tempDir, path.basename(elfPath));
      // readFileSync + writeFileSync (not copyFileSync) guarantees the
      // original is only opened with libuv's share-delete flags.
      await fs.promises.writeFile(dest, await fs.promises.readFile(elfPath));
      elfForTools = dest;
      if (this.debug) {
        console.log(`[STM32 Parser] Analyzing ELF copy: ${dest}`);
      }
    } catch (err: any) {
      if (this.debug) {
        console.warn(`[STM32 Parser] Could not create ELF copy, using original: ${err?.message ?? err}`);
      }
      if (tempDir) {
        await this.removeTempDir(tempDir);
        tempDir = undefined;
      }
      elfForTools = elfPath;
    }

    try {
      await fn(elfForTools);
    } finally {
      if (tempDir) {
        await this.removeTempDir(tempDir);
      }
    }
  }

  private async removeTempDir(dir: string): Promise<void> {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch (err: any) {
      if (this.debug) {
        console.warn(`[STM32 Parser] Failed to remove temp dir ${dir}: ${err?.message ?? err}`);
      }
    }
  }

  private parseMap(mapFile: string): Region[] {
    let content: string;
    try {
      content = fs.readFileSync(mapFile, 'utf8');
    } catch (err: any) {
      throw new Error(
        `STM32 Build Analyzer: cannot read MAP file "${mapFile}": `
        + `${err?.message ?? String(err)}`
      );
    }

    if (content.trim().length === 0) {
      throw new Error(`STM32 Build Analyzer: MAP file is empty: "${mapFile}".`);
    }

    const lines = content.split('\n');
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

    if (regs.length === 0) {
      throw new Error(
        `STM32 Build Analyzer: MAP file "${mapFile}" does not contain a supported `
        + 'GNU linker Memory Configuration with at least one usable memory region.'
      );
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

  private async parseSections(
    elfFile: string,
    regions: Region[],
    signal?: AbortSignal
  ): Promise<void> {
    const stdout = await this.runTool(
      'arm-none-eabi-objdump',
      ['-h', elfFile],
      8 * 1024 * 1024,
      signal
    );
    const lines = stdout.split('\n');
    const secRx = /^\s*\d+\s+(\S+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)/;
    const allocRx = /\bALLOC\b/;
    const loadRx = /\bLOAD\b/;
    const contentsRx = /\bCONTENTS\b/;
    let prev = '';
    let assignedSections = 0;

    for (const l of lines) {
      if (!allocRx.test(l)) { prev = l; continue; }
      const m = secRx.exec(prev);
      if (!m) { continue; }

      const name = m[1],
        size = parseInt(m[2], 16),
        addr = parseInt(m[3], 16),
        load = parseInt(m[4], 16);
      if (size === 0) { continue; }

      const runtimeRegion = this.findRegion(regions, addr);
      if (runtimeRegion) {
        this.addSection(runtimeRegion, name, addr, load, size, 'runtime');
        assignedSections++;
      }

      const hasLoadImage = load !== addr && loadRx.test(l) && contentsRx.test(l);
      const loadRegion = hasLoadImage ? this.findRegion(regions, load) : undefined;
      if (loadRegion) {
        this.addSection(loadRegion, name, load, load, size, 'load');
        assignedSections++;
      }
    }

    if (regions.length > 0 && assignedSections === 0) {
      throw new Error(
        'STM32 Build Analyzer: objdump completed successfully, but no allocatable ELF sections '
        + 'matched the map memory regions. Verify that the selected .map and .elf files belong '
        + 'to the same build.'
      );
    }
  }

  private findRegion(regions: Region[], address: number): Region | undefined {
    return regions.find(region =>
      address >= region.startAddress && address < region.startAddress + region.size
    );
  }

  private addSection(
    region: Region,
    name: string,
    startAddress: number,
    loadAddress: number,
    size: number,
    placement: 'runtime' | 'load'
  ): void {
    region.sections.push({ name, startAddress, size, loadAddress, symbols: [] });
    region.used += size;
    if (this.debug) {
      console.log(
        `[STM32 Parser] Section ${name} ${placement} image assigned to region ${region.name}`
      );
    }
  }

  private async parseSymbols(
    elfFile: string,
    regions: Region[],
    sourceBaseDirectory: string = path.dirname(elfFile),
    signal?: AbortSignal
  ): Promise<void> {
    const stdout = await this.runTool(
      'arm-none-eabi-nm',
      ['-C', '-S', '-n', '-l', '--defined-only', elfFile],
      32 * 1024 * 1024,
      signal
    );
    const lines = stdout.split('\n');
    const symRx = /^([0-9A-Fa-f]+)(?:\s+([0-9A-Fa-f]+))?\s+\w\s+(.+)$/;
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
        symbolDetails = m[3];
      const separator = symbolDetails.lastIndexOf('\t');
      const name = (separator >= 0
        ? symbolDetails.slice(0, separator)
        : symbolDetails
      ).trim();
      const raw = separator >= 0
        ? symbolDetails.slice(separator + 1).trim()
        : '';
      let file = '', row = 0;

      const pm = pathRx.exec(raw);
      if (pm) {
        file = path.isAbsolute(pm[1])
          ? path.normalize(pm[1])
          : path.resolve(sourceBaseDirectory, pm[1]);
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

  private async runTool(
    exe: string,
    args: string[],
    maxBuffer: number,
    signal?: AbortSignal
  ): Promise<string> {
    const cmd = this.getTool(exe);
    let out: ToolRunResult;

    try {
      out = await this.toolRunner(cmd, args, {
        maxBuffer,
        timeoutMs: TOOL_TIMEOUT_MS,
        signal,
      });
    } catch (err: any) {
      throw this.createToolExecutionError(exe, cmd, err?.message ?? String(err));
    }

    if (out.error instanceof AnalysisCancelledError) {
      throw out.error;
    }

    if (out.error || out.status !== 0) {
      const reason = out.error?.message
        ?? (out.signal
          ? `terminated by signal ${out.signal}`
          : `exited with code ${out.status ?? 'unknown'}`);
      const stderr = out.stderr?.toString().trim().replace(/\s+/g, ' ');
      const details = stderr
        ? `${reason}; ${stderr.slice(0, 500)}`
        : reason;
      throw this.createToolExecutionError(exe, cmd, details);
    }

    return out.stdout?.toString() ?? '';
  }

  private createToolExecutionError(exe: string, cmd: string, details: string): ToolExecutionError {
    const guidance = this.toolchainPath
      ? 'Check stm32BuildAnalyzerEnhanced.toolchainPath and the configured toolchain binaries.'
      : `Install ${exe}, add it to PATH, or configure stm32BuildAnalyzerEnhanced.toolchainPath.`;
    const message = `STM32 Build Analyzer: failed to run ${exe} (${cmd}): ${details}. ${guidance}`;

    if (this.debug) {
      console.error(`[STM32 Parser] ${message}`);
    }

    return new ToolExecutionError(exe, cmd, message);
  }

  private getTool(exe: string): string {
    const full = path.join(this.toolchainPath, getToolFilename(exe));
    if (this.toolchainPath && fs.existsSync(full)) {
      if (this.debug) {console.log(`[STM32 Parser] Using tool: ${full}`);}
      return full;
    }

    if (this.debug) {console.warn(`[STM32 Parser] Falling back to ${exe} from PATH`);}
    return exe;
  }
}
