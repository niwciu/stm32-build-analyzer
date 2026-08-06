import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  findUnresolvedPathVariables,
  resolveVariables as applyVariables,
} from '../utils/pathVariables';
import {
  discoverBuildPairsInRoots,
  DiscoveredBuildPair,
} from '../utils/buildDiscovery';
import { UserCancelledError } from '../utils/errors';

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
  private workspaceRoots: Array<{ name: string; path: string }> = [];
  private lastToolchainWarning?: string;

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
      ? this.resolveCustomPath(
        this.resolveRequiredVariables(customMap, 'mapFilePath'),
        workspaceRoot
      )
      : undefined;
    const resolvedCustomElf = customElf
      ? this.resolveCustomPath(
        this.resolveRequiredVariables(customElf, 'elfFilePath'),
        workspaceRoot
      )
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
    this.workspaceRoots = workspaceFolders.map(folder => ({
      name: folder.name,
      path: folder.uri.fsPath,
    }));

    if (this.debug) {
      this.workspaceRoots.forEach(folder =>
        console.log(`[STM32] Scanning workspace folder: ${folder.path}`)
      );
    }

    const resolvedManualPairs = await this.resolveManualPairs(root, manualPairs);
    const autoPairs = await this.findBuildPairs(
      this.workspaceRoots.map(folder => folder.path)
    );
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
        throw new UserCancelledError('Build output selection cancelled');
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
    const resolvedVariables = this.resolveVariables(raw);
    const unresolved = findUnresolvedPathVariables(resolvedVariables);
    if (unresolved.length > 0) {
      this.showToolchainWarning(
        `STM32 Build Analyzer: toolchainPath contains unresolved variable(s): `
        + `${unresolved.join(', ')}. Check environment variables and workspace folder names.`
      );
      return undefined;
    }
    const resolved = this.resolveCustomPath(resolvedVariables, workspaceRoot);
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

  private async findBuildPairs(roots: readonly string[]): Promise<ResolvedBuildPair[]> {
    const found: DiscoveredBuildPair[] = await discoverBuildPairsInRoots(roots);
    if (this.debug) {
      found.forEach(pair =>
        console.log(`[STM32] Found build pair: ${pair.map} + ${pair.elf}`)
      );
    }
    return found;
  }

  private async resolveManualPairs(root: string, pairs: ManualBuildPair[]): Promise<ResolvedBuildPair[]> {
    const resolved: ResolvedBuildPair[] = [];

    for (const pair of pairs) {
      if (!pair.folder || !pair.map || !pair.elf) {
        if (this.debug) {console.warn('[STM32] Skipping invalid manual pair entry.');}
        continue;
      }

      const resolvedFolder = this.resolveVariables(pair.folder);
      const resolvedMap = this.resolveVariables(pair.map);
      const resolvedElf = this.resolveVariables(pair.elf);
      const unresolved = findUnresolvedPathVariables(
        `${resolvedFolder}\n${resolvedMap}\n${resolvedElf}`
      );
      if (unresolved.length > 0) {
        throw new Error(
          `STM32 Build Analyzer: manualBuildPairs entry "${pair.label ?? pair.folder}" `
          + `contains unresolved variable(s): ${unresolved.join(', ')}.`
        );
      }
      const folderPath = path.isAbsolute(resolvedFolder)
        ? resolvedFolder
        : path.join(root, resolvedFolder);
      const mapPath = path.isAbsolute(resolvedMap)
        ? resolvedMap
        : path.join(folderPath, resolvedMap);
      const elfPath = path.isAbsolute(resolvedElf)
        ? resolvedElf
        : path.join(folderPath, resolvedElf);

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

  private resolveRequiredVariables(value: string, setting: string): string {
    const resolved = this.resolveVariables(value);
    const unresolved = findUnresolvedPathVariables(resolved);
    if (unresolved.length > 0) {
      throw new Error(
        `STM32 Build Analyzer: ${setting} contains unresolved variable(s): `
        + `${unresolved.join(', ')}. Check environment variables and workspace folder names.`
      );
    }
    return resolved;
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
      const workspace = this.workspaceRoots.find(folder => {
        const relative = path.relative(folder.path, value);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
      });
      if (!workspace) {
        return value;
      }
      const relative = path.relative(workspace.path, value) || path.basename(value);
      return this.workspaceRoots.length > 1
        ? `${workspace.name}/${relative}`
        : relative;
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
