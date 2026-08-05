import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { resolveVariables as applyVariables } from '../utils/pathVariables';

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
  | { kind: 'auto'; folder: string };

export class BuildFolderResolver {
  private readonly debug: boolean;
  private workspaceRoot?: string;
  private autoDisplayNames = new Map<string, string>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.debug = vscode.workspace
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
    const folders = await this.findBuildFolders(root);
    this.autoDisplayNames = new Map();
    folders.forEach(folder => {
      this.autoDisplayNames.set(folder, this.getBuildDisplayName(folder));
    });
    const selections = this.buildSelections(resolvedManualPairs, folders);
    if (selections.length === 0) {
      throw new Error('No build folders containing both .map and .elf found');
    }

    let selection = selections[0];
    if (selections.length > 1) {
      if (this.debug) {
        console.log(`[STM32] Multiple build targets found:`);
        selections.forEach(s => {
          if (s.kind === 'manual') {
            console.log(` → Manual: ${s.pair.folder}`);
          } else {
            console.log(` → Auto: ${s.folder}`);
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

    if (selection.kind === 'manual') {
      if (this.debug) {
        console.log(`[STM32] Selected manual pair: ${selection.pair.map} + ${selection.pair.elf}`);
      }
      return {
        map: selection.pair.map,
        elf: selection.pair.elf,
        toolchainPath: await this.getToolchainPath(),
      };
    }

    if (this.debug) {console.log(`[STM32] Selected folder: ${selection.folder}`);}

    const mapFile = await this.findFile(selection.folder, '.map');
    const elfFile = await this.findFile(selection.folder, '.elf');
    if (!mapFile || !elfFile) {
      throw new Error(`Missing .map or .elf in ${selection.folder}`);
    }

    return {
      map: mapFile,
      elf: elfFile,
      toolchainPath: await this.getToolchainPath(),
    };
  }

  private async getToolchainPath(): Promise<string | undefined> {
    const cfg = vscode.workspace.getConfiguration('stm32BuildAnalyzerEnhanced');
    const raw = cfg.get<string>('toolchainPath');

    if (!raw) {return undefined;}

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const resolved = this.resolveCustomPath(this.resolveVariables(raw), workspaceRoot);
    if (!resolved) {return undefined;}

    if (await this.exists(resolved)) {
      if (this.debug) {console.log(`[STM32] Using toolchain: ${resolved}`);}
      return resolved;
    }

    vscode.window.showWarningMessage(
      `STM32 Build Analyzer: toolchainPath not found: ${resolved}`
      + (resolved !== raw ? ` (resolved from: ${raw})` : '')
    );
    if (this.debug) {console.warn(`[STM32] Toolchain path not found: ${resolved}`);}

    return undefined;
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

  private async findBuildFolders(root: string): Promise<string[]> {
    const found = new Set<string>();
    const ignored = new Set(['node_modules', '.git', '.vscode', 'dist']);
    const visited = new Set<string>();

    const walk = (dir: string) => {
      try {
        const realPath = fs.realpathSync(dir);
        if (visited.has(realPath)) {
          return;
        }
        visited.add(realPath);

        let hasMap = false, hasElf = false;
        for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
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
          } else if (d.name.toLowerCase().endsWith('.map')) {
            hasMap = true;
          } else if (d.name.toLowerCase().endsWith('.elf')) {
            hasElf = true;
          }
        }
        if (hasMap && hasElf) {
          if (this.debug) {console.log(`[STM32] Found build folder: ${dir}`);}
          found.add(dir);
        }
      } catch (err) {
        if (this.debug) {console.warn(`[STM32] Failed to access folder: ${dir}`);}
      }
    };

    walk(root);

    return Array.from(found);
  }

  private async findFile(folder: string, ext: string): Promise<string | undefined> {
    const extLower = ext.toLowerCase();
    const files = fs.readdirSync(folder).filter(f => f.toLowerCase().endsWith(extLower));
    if (files.length === 0) {
      if (this.debug) {console.warn(`[STM32] No ${ext} files in ${folder}`);}
      return undefined;
    }

    files.sort((a, b) => {
      if (a.includes('Release')) {return -1;}
      if (b.includes('Release')) {return 1;}
      if (a.includes('Debug')) {return -1;}
      if (b.includes('Debug')) {return 1;}
      return 0;
    });

    const p = path.join(folder, files[0]);

    try {
      fs.accessSync(p, fs.constants.R_OK);

      if (ext === '.map' && fs.statSync(p).size === 0) {
        throw new Error('Map file is empty');
      }

      if (this.debug) {console.log(`[STM32] Selected ${ext} file: ${p}`);}
      return p;
    } catch (err) {
      if (this.debug) {console.warn(`[STM32] Could not use file: ${p}`);}
      return undefined;
    }
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
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return applyVariables(value, wsRoot);
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

  private buildSelections(manualPairs: ResolvedBuildPair[], folders: string[]): BuildSelection[] {
    const selections: BuildSelection[] = [];
    manualPairs.forEach(pair => selections.push({ kind: 'manual', pair }));
    folders.forEach(folder => selections.push({ kind: 'auto', folder }));
    return selections;
  }

  private getBuildDisplayName(folder: string): string {
    try {
      const files = fs.readdirSync(folder);
      const elf = files.find(file => file.toLowerCase().endsWith('.elf'));
      if (elf) {
        return path.basename(elf).replace(/\.elf$/i, '');
      }
      const map = files.find(file => file.toLowerCase().endsWith('.map'));
      if (map) {
        return path.basename(map).replace(/\.map$/i, '');
      }
    } catch (err) {
      if (this.debug) {
        console.warn(`[STM32] Failed to read build folder: ${folder}`);
      }
    }
    return path.basename(folder);
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

    const displayName = this.autoDisplayNames.get(selection.folder) ?? this.getBuildDisplayName(selection.folder);

    return {
      label: `$(file-binary) ${displayName}`,
      detail: resolveRelative(selection.folder),
      selection,
    };
  }
}
