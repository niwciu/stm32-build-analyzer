import * as vscode from 'vscode';
import * as path from 'path';
import {
  createDefaultAnalysisOrchestrator,
} from './analysis/AnalysisOrchestrator';
import type { BuildAnalysisResult } from './analysis/contracts';
import type { BuildArtifactSet } from './artifacts/BuildArtifactSet';
import { FileWatcherService } from './services/FileWatcherService';
import { BuildFolderResolver, BuildPaths } from './services/BuildFolderResolver';
import { toAnalysisViewModel } from './presentation/analysisViewModel';
import { WebviewRenderer } from './ui/WebviewRenderer';
import { assertWorkspaceTrusted } from './utils/workspaceTrust';
import {
  AnalysisCancelledError,
  UserCancelledError,
} from './utils/errors';

export interface AnalysisService {
  analyze(
    artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<BuildAnalysisResult>;
}

export type AnalysisServiceFactory = (
  toolchainPath: string,
  debug: boolean
) => AnalysisService;
type RefreshOutcome = 'success' | 'cancelled' | 'superseded' | 'failed';

export class BuildAnalyzerProvider implements vscode.WebviewViewProvider {
  private watcher: FileWatcherService;
  private resolver: BuildFolderResolver;
  private renderer?: WebviewRenderer;
  private paths?: BuildPaths;
  private pathConfigurationGeneration = 0;
  private lastRefreshError?: string;
  private activeRefresh?: AbortController;
  private refreshGeneration = 0;
  private preferredBuildPaths?: Pick<BuildPaths, 'map' | 'elf'>;
  private readonly configurationDisposable: vscode.Disposable;
  private readonly workspaceTrustDisposable: vscode.Disposable;
  private readonly workspaceFoldersDisposable: vscode.Disposable;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly analysisServiceFactory: AnalysisServiceFactory =
      (toolchainPath, debug) => createDefaultAnalysisOrchestrator({
        toolchainPath,
        debug,
        detectionOptions: {
          debugLogger: debug
            ? message => console.log(message)
            : undefined,
        },
      })
  ) {
    this.watcher  = new FileWatcherService(() => this.refresh());
    this.resolver = new BuildFolderResolver();
    this.configurationDisposable = vscode.workspace.onDidChangeConfiguration(event => {
      const buildPathsChanged = this.affectsBuildPathConfiguration(event);
      const toolchainChanged = event.affectsConfiguration(
        'stm32BuildAnalyzerEnhanced.toolchainPath'
      );
      if (!buildPathsChanged && !toolchainChanged) {
        return;
      }

      if (buildPathsChanged) {
        this.invalidatePaths();
      } else {
        this.lastRefreshError = undefined;
      }
      if (this.renderer) {
        void this.refresh();
      }
    });
    this.context.subscriptions.push(this.configurationDisposable);
    this.workspaceTrustDisposable = vscode.workspace.onDidGrantWorkspaceTrust(() => {
      this.invalidatePaths();
      if (this.renderer) {
        void this.refresh();
      }
    });
    this.context.subscriptions.push(this.workspaceTrustDisposable);
    this.workspaceFoldersDisposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const previousPaths = this.paths;
      this.invalidatePaths(previousPaths);
      if (this.renderer) {
        void this.refresh();
      }
    });
    this.context.subscriptions.push(this.workspaceFoldersDisposable);

    this.watcher.start();

    if (this.debug) {
      console.log('[STM32 Provider] Initialized.');
    }
  }

  private get debug(): boolean {
    return vscode.workspace
      .getConfiguration('stm32BuildAnalyzerEnhanced')
      .get<boolean>('debug') ?? false;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.renderer = new WebviewRenderer(this.context, view);
    this.renderer.init();

    if (this.debug) {
      console.log('[STM32 Provider] Webview resolved.');
    }

    view.onDidChangeVisibility(() => {
      if (view.visible) {
        if (this.debug) {console.log('[STM32 Provider] View visible, triggering refresh...');}
        this.refresh();
      }
    });
  }

  /** Fast refresh – analyzes using cached paths. */
  public async refresh(): Promise<RefreshOutcome> {
    const refreshGeneration = ++this.refreshGeneration;
    this.activeRefresh?.abort();
    const controller = new AbortController();
    this.activeRefresh = controller;

    try {
      if (this.debug) {console.log('[STM32 Provider] Refresh triggered');}

      assertWorkspaceTrusted(vscode.workspace.isTrusted);

      const generation = this.pathConfigurationGeneration;
      const cachedPaths = this.paths;
      const resolvedPaths = cachedPaths ?? await this.resolver.resolve(
        controller.signal,
        this.preferredBuildPaths
      );
      const paths = cachedPaths
        ? {
          ...cachedPaths,
          toolchainPath: await this.resolver.resolveToolchainPath(),
        }
        : resolvedPaths;
      if (controller.signal.aborted || refreshGeneration !== this.refreshGeneration) {
        return 'superseded';
      }
      if (generation !== this.pathConfigurationGeneration) {
        if (this.debug) {
          console.log('[STM32 Provider] Ignoring paths resolved from stale configuration.');
        }
        return 'superseded';
      }
      this.paths = paths;
      this.preferredBuildPaths = undefined;
      this.watcher.watchFiles([paths.map, paths.elf]);

      if (!paths.map || !paths.elf) {
        throw new Error('Missing required build paths.');
      }

      const root = vscode.workspace
        .getWorkspaceFolder(vscode.Uri.file(paths.map))
        ?.uri.fsPath
        ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        throw new Error('No workspace open to resolve relative paths');
      }

      const rel = path.relative(root, paths.map);
      const buildFolder = path.dirname(rel);
      const analysisService = this.analysisServiceFactory(
        paths.toolchainPath ?? '',
        this.debug
      );
      const result = await analysisService.analyze({
        mapPath: paths.map,
        executablePath: paths.elf,
        linkerScriptPaths: [],
        workspaceFolder: root,
      }, controller.signal);
      if (
        controller.signal.aborted
        || refreshGeneration !== this.refreshGeneration
        || generation !== this.pathConfigurationGeneration
      ) {
        return 'superseded';
      }

      const viewModel = toAnalysisViewModel(result);
      this.renderer?.showAnalysis(viewModel, buildFolder);

      if (result.status === 'cancelled') {
        this.lastRefreshError = undefined;
        return 'cancelled';
      }
      if (result.status === 'invalid') {
        if (viewModel.kind !== 'status') {
          throw new Error('Invalid analysis result mapped to a data view.');
        }
        const message = `${viewModel.title}: ${viewModel.message}`;
        if (message !== this.lastRefreshError) {
          this.lastRefreshError = message;
          vscode.window.showErrorMessage(message);
        }
        return 'failed';
      }

      this.lastRefreshError = undefined;

      if (this.debug) {
        const regionCount = viewModel.kind === 'data'
          ? viewModel.regions.length
          : 0;
        console.log(
          `[STM32 Provider] Analysis status ${result.status}; `
          + `${regionCount} region(s)`
        );
      }
      return 'success';

    } catch (e: any) {
      if (e instanceof AnalysisCancelledError || controller.signal.aborted) {
        return 'superseded';
      }
      if (e instanceof UserCancelledError) {
        if (this.debug) {
          console.log(`[STM32 Provider] ${e.message}`);
        }
        return 'cancelled';
      }
      const message = e.message || String(e);
      this.renderer?.showError(message);
      if (message !== this.lastRefreshError) {
        this.lastRefreshError = message;
        vscode.window.showErrorMessage(message);
      }
      if (this.debug) {
        console.error('[STM32 Provider] Error during refresh:', e);
      }
      return 'failed';
    } finally {
      if (this.activeRefresh === controller) {
        this.activeRefresh = undefined;
      }
    }
  }

  /** Full refresh – clears cache and forces reselection of build folder */
  public async fullRefresh() {
    if (this.debug) {console.log('[STM32 Provider] Full refresh requested.');}
    const previousPaths = this.paths;
    this.invalidatePaths();
    const outcome = await this.refresh();
    if (outcome === 'cancelled' && previousPaths && !this.paths) {
      this.paths = previousPaths;
      this.watcher.watchFiles([previousPaths.map, previousPaths.elf]);
    }
  }

  dispose(): void {
    this.activeRefresh?.abort();
    this.configurationDisposable.dispose();
    this.workspaceTrustDisposable.dispose();
    this.workspaceFoldersDisposable.dispose();
    this.watcher.dispose();
    if (this.debug) {console.log('[STM32 Provider] Disposed.');}
  }

  private affectsBuildPathConfiguration(event: vscode.ConfigurationChangeEvent): boolean {
    return [
      'mapFilePath',
      'elfFilePath',
      'manualBuildPairs',
    ].some(setting =>
      event.affectsConfiguration(`stm32BuildAnalyzerEnhanced.${setting}`)
    );
  }

  private invalidatePaths(preferredPaths?: Pick<BuildPaths, 'map' | 'elf'>): void {
    this.pathConfigurationGeneration++;
    this.paths = undefined;
    this.preferredBuildPaths = preferredPaths
      ? { map: preferredPaths.map, elf: preferredPaths.elf }
      : undefined;
    this.lastRefreshError = undefined;
    this.watcher.watchFiles([]);
  }
}
