import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { resolveVariables as applyVariables } from '../utils/pathVariables';
import { pairBuildOutputNames } from '../utils/buildPairs';

export interface BuildPaths {
  map: string;
  elf: string;
  toolchainPath?: string;
}

interface ManualBuildPair {
  folder: string;
  map: string;
  elf: string;
  label?: string;
}

interface ResolvedBuildPair {
  folder: string;
  map: string;
  elf: string;
  label: string;
}

type BuildSelection =
  | { kind: 'manual'; pair: ResolvedBuildPair }
  | { kind: 'auto'; pair: ResolvedBuildPair };

export class BuildFolderResolver {
  private workspaceRoot?: string;
  private lastToolchainWarning?: string;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private get debug(): boolean {
    return vscode.workspace
      .getConfiguration('stm32BuildAnalyzerEnhanced')
      .get<boolean>('debug') ?? false;
  }

  public async resolve(): Promise<BuildPaths> {
    const cfg = vscode.workspace.getConfiguration('stm32BuildAnalyzerEnhanced');
    const customMap = cfg.get<string>('mapFilePath');
    const customElf = cfg.get<string>('elfFilePath');
    const manualPairs = cfg.get<ManualBuildPair[]>('manualBuildPairs') ?? [];

    if (this.debug) {
      console.log('[STM32] Resolving build paths...');
      console.log(`[STM32] Custom map: ${customMap}`);
      console.log(`[STM32] Custom elf: ${customElf}`);
      if (manualPairs.length > 0) {
        console.log(`[STM32] Manual pairs configured: ${manualPairs.length}`);
      }
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const resolvedCustomMap = customMap
      ? this.resolveCustomPath(this.resolveVariables(customMap), workspaceRoot)
      : undefined;
    const resolvedCustomElf = customElf
      ? this.resolveCustomPath(this.resolveVariables(customElf), workspaceRoot)
      : undefined;

    if (
      resolvedCustomMap
      && resolvedCustomElf
      && await this.exists(resolvedCustomMap)
      && await this.exists(resolvedCustomElf)
    ) {
      if (this.debug) {console.log('[STM32] Using custom paths from settings.');}
      return {
        map: resolvedCustomMap,
        elf: resolvedCustomElf,
        toolchainPath: await this.getToolchainPath(),
      };
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error('No workspace folder open');
    }

    const root = workspaceFolders[0].uri.fsPath;
    this.workspaceRoot = root;

    if (this.debug) {console.log(`[STM32] Scanning workspace folder: ${root}`);}

    const resolvedManualPairs = await this.resolveManualPairs(root, manualPairs);
    const autoPairs = await this.findBuildPairs(root);
    const selections = this.buildSelections(resolvedManualPairs, autoPairs);
    if (selections.length === 0) {
      throw new Error(
        'No matching .map/.elf build outputs found. Automatic discovery requires '
        + 'the same basename; configure a manual pair when output names differ.'
      );
    }

    let selection = selections[0];
    if (selections.length > 1) {
      if (this.debug) {
        console.log(`[STM32] Multiple build targets found:`);
        selections.forEach(s => {
          if (s.kind === 'manual') {
            console.log(` → Manual: ${s.pair.folder}`);
          } else {
            console.log(` → Auto: ${s.pair.map} + ${s.pair.elf}`);
          }
        });
      }

      const pick = await vscode.window.showQuickPick(
        selections.map(s => this.toQuickPick(s)),
        { placeHolder: 'Select build output or manual map/elf pair' }
      );
      if (!pick) {
        throw new Error('Build folder selection cancelled');
      }
      selection = pick.selection;
    }

    if (this.debug) {
      console.log(
        `[STM32] Selected ${selection.kind} pair: `
        + `${selection.pair.map} + ${selection.pair.elf}`
      );
    }

    return {
      map: selection.pair.map,
      elf: selection.pair.elf,
      toolchainPath: await this.getToolchainPath(),
    };
  }

  private async getToolchainPath(): Promise<string | undefined> {
    const cfg = vscode.workspace.getConfiguration('stm32BuildAnalyzerEnhanced');
    const raw = cfg.get<string>('toolchainPath');

    if (!raw) {
      this.lastToolchainWarning = undefined;
      return undefined;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const resolved = this.resolveCustomPath(this.resolveVariables(raw), workspaceRoot);
    if (!resolved) {return undefined;}

    if (await this.exists(resolved)) {
      if (this.debug) {console.log(`[STM32] Using toolchain: ${resolved}`);}
      this.lastToolchainWarning = undefined;
      return resolved;
    }

    this.showToolchainWarning(
      `STM32 Build Analyzer: toolchainPath not found: ${resolved}`
      + (resolved !== raw ? ` (resolved from: ${raw})` : '')
    );
    if (this.debug) {console.warn(`[STM32] Toolchain path not found: ${resolved}`);}

    return undefined;
  }

  private showToolchainWarning(message: string): void {
    if (message === this.lastToolchainWarning) {
      return;
    }
    this.lastToolchainWarning = message;
    vscode.window.showWarningMessage(message);
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      return true;
    } catch {
      if (this.debug) {console.warn(`[STM32] File not accessible: ${filePath}`);}
      return false;
    }
  }

  private async findBuildPairs(root: string): Promise<ResolvedBuildPair[]> {
    const found: ResolvedBuildPair[] = [];
    const ignored = new Set(['node_modules', '.git', '.vscode', 'dist']);
    const visited = new Set<string>();

    const walk = (dir: string) => {
      try {
        const realPath = fs.realpathSync(dir);
        if (visited.has(realPath)) {
          return;
        }
        visited.add(realPath);

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const d of entries) {
          const full = path.join(dir, d.name);
          if (d.isDirectory()) {
            if (!ignored.has(d.name)) {
              walk(full);
            }
          } else if (d.isSymbolicLink()) {
            try {
              const stats = fs.statSync(full);
              if (stats.isDirectory() && !ignored.has(d.name)) {
                walk(full);
              }
            } catch (err) {
              if (this.debug) {console.warn(`[STM32] Failed to stat symlink: ${full}`);}
            }
          }
        }

        const files = entries.filter(entry => entry.isFile()).map(entry => entry.name);
        for (const pair of pairBuildOutputNames(files)) {
          const mapFile = path.join(dir, pair.map);
          const elfFile = path.join(dir, pair.elf);
          try {
            fs.accessSync(mapFile, fs.constants.R_OK);
            fs.accessSync(elfFile, fs.constants.R_OK);
            if (fs.statSync(mapFile).size === 0) {
              continue;
            }
            found.push({
              folder: dir,
              map: mapFile,
              elf: elfFile,
              label: pair.stem,
            });
            if (this.debug) {
              console.log(`[STM32] Found build pair: ${mapFile} + ${elfFile}`);
            }
          } catch {
            if (this.debug) {
              console.warn(`[STM32] Build pair is not readable: ${mapFile} + ${elfFile}`);
            }
          }
        }
      } catch (err) {
        if (this.debug) {console.warn(`[STM32] Failed to access folder: ${dir}`);}
      }
    };

    walk(root);

    return found.sort((a, b) =>
      a.folder.localeCompare(b.folder) || a.label.localeCompare(b.label)
    );
  }

  private async resolveManualPairs(root: string, pairs: ManualBuildPair[]): Promise<ResolvedBuildPair[]> {
    const resolved: ResolvedBuildPair[] = [];

    for (const pair of pairs) {
      if (!pair.folder || !pair.map || !pair.elf) {
        if (this.debug) {console.warn('[STM32] Skipping invalid manual pair entry.');}
        continue;
      }

      const folderPath = path.isAbsolute(pair.folder)
        ? pair.folder
        : path.join(root, pair.folder);
      const mapPath = path.isAbsolute(pair.map)
        ? pair.map
        : path.join(folderPath, pair.map);
      const elfPath = path.isAbsolute(pair.elf)
        ? pair.elf
        : path.join(folderPath, pair.elf);

      const mapOk = await this.exists(mapPath);
      const elfOk = await this.exists(elfPath);

      if (!mapOk || !elfOk) {
        if (this.debug) {
          console.warn(`[STM32] Manual pair not accessible: ${mapPath} ${elfPath}`);
        }
        continue;
      }

      resolved.push({
        folder: folderPath,
        map: mapPath,
        elf: elfPath,
        label: pair.label ?? path.basename(folderPath),
      });
    }

    return resolved;
  }

  private resolveVariables(value: string): string {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const wsRoot = workspaceFolders[0]?.uri.fsPath;
    return applyVariables(
      value,
      wsRoot,
      workspaceFolders.map(folder => ({
        name: folder.name,
        path: folder.uri.fsPath,
      }))
    );
  }

  private resolveCustomPath(value: string, root?: string): string | undefined {
    if (path.isAbsolute(value)) {
      return value;
    }
    if (!root) {
      return undefined;
    }
    return path.join(root, value);
  }

  private buildSelections(
    manualPairs: ResolvedBuildPair[],
    autoPairs: ResolvedBuildPair[]
  ): BuildSelection[] {
    const selections: BuildSelection[] = [];
    manualPairs.forEach(pair => selections.push({ kind: 'manual', pair }));
    autoPairs.forEach(pair => selections.push({ kind: 'auto', pair }));
    return selections;
  }

  private toQuickPick(selection: BuildSelection): vscode.QuickPickItem & { selection: BuildSelection } {
    const resolveRelative = (value: string) => {
      if (!this.workspaceRoot) {
        return value;
      }
      const relative = path.relative(this.workspaceRoot, value);
      return relative || path.basename(value);
    };

    if (selection.kind === 'manual') {
      const mapName = path.basename(selection.pair.map).replace(/\.map$/i, '');
      const elfName = path.basename(selection.pair.elf).replace(/\.elf$/i, '');
      return {
        label: `$(file-binary) ${elfName} + ${mapName} (Manual)`,
        detail: `${resolveRelative(selection.pair.elf)} | ${resolveRelative(selection.pair.map)}`,
        selection,
      };
    }

    return {
      label: `$(file-binary) ${selection.pair.label}`,
      detail: `${resolveRelative(selection.pair.elf)} | ${resolveRelative(selection.pair.map)}`,
      selection,
    };
  }
}
