import * as vscode from 'vscode';
import * as path from 'path';
import { FileWatcherService } from './services/FileWatcherService';
import { BuildFolderResolver, BuildPaths } from './services/BuildFolderResolver';
import { MapElfParser } from './services/MapElfParser';
import { WebviewRenderer } from './ui/WebviewRenderer';
import { findMissingToolchainBinaries } from './utils/toolchain';

export type MapElfParserFactory = (toolchainPath: string, debug: boolean) => MapElfParser;

export class BuildAnalyzerProvider implements vscode.WebviewViewProvider {
  private watcher: FileWatcherService;
  private resolver: BuildFolderResolver;
  private renderer?: WebviewRenderer;
  private paths?: BuildPaths;
  private pathConfigurationGeneration = 0;
  private lastMissingToolWarning?: string;
  private lastRefreshError?: string;
  private readonly configurationDisposable: vscode.Disposable;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly parserFactory: MapElfParserFactory =
      (toolchainPath, debug) => new MapElfParser(toolchainPath, debug)
  ) {
    this.watcher  = new FileWatcherService(context, () => this.refresh());
    this.resolver = new BuildFolderResolver(context);
    this.configurationDisposable = vscode.workspace.onDidChangeConfiguration(event => {
      if (!this.affectsBuildConfiguration(event)) {
        return;
      }

      this.invalidatePaths();
      if (this.renderer) {
        void this.refresh();
      }
    });
    this.context.subscriptions.push(this.configurationDisposable);

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

  /** Fast refresh – parses using cached paths */
  public async refresh() {
    try {
      if (this.debug) {console.log('[STM32 Provider] Refresh triggered');}

      const generation = this.pathConfigurationGeneration;
      const paths = this.paths ?? await this.resolver.resolve();
      if (generation !== this.pathConfigurationGeneration) {
        if (this.debug) {
          console.log('[STM32 Provider] Ignoring paths resolved from stale configuration.');
        }
        return;
      }
      this.paths = paths;

      if (!paths.map || !paths.elf) {
        throw new Error('Missing required build paths.');
      }

      await this.warnAboutMissingToolchainBinaries(paths.toolchainPath);
      if (generation !== this.pathConfigurationGeneration) {
        return;
      }

      const parser = this.parserFactory(paths.toolchainPath ?? '', this.debug);
      const regions = parser.parse(paths.map, paths.elf);

      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        throw new Error('No workspace open to resolve relative paths');
      }

      const rel = path.relative(root, paths.map);

      this.renderer?.showData(regions, path.dirname(rel));
      this.lastRefreshError = undefined;

      if (this.debug) {
        console.log(`[STM32 Provider] Parsed ${regions.length} region(s)`);
      }

    } catch (e: any) {
      const message = e.message || String(e);
      if (message !== this.lastRefreshError) {
        this.lastRefreshError = message;
        vscode.window.showErrorMessage(message);
      }
      if (this.debug) {
        console.error('[STM32 Provider] Error during refresh:', e);
      }
    }
  }

  /** Full refresh – clears cache and forces reselection of build folder */
  public async fullRefresh() {
    if (this.debug) {console.log('[STM32 Provider] Full refresh requested.');}
    this.invalidatePaths();
    await this.refresh();
  }

  dispose(): void {
    this.configurationDisposable.dispose();
    this.watcher.dispose();
    if (this.debug) {console.log('[STM32 Provider] Disposed.');}
  }

  private affectsBuildConfiguration(event: vscode.ConfigurationChangeEvent): boolean {
    return [
      'toolchainPath',
      'mapFilePath',
      'elfFilePath',
      'manualBuildPairs',
    ].some(setting =>
      event.affectsConfiguration(`stm32BuildAnalyzerEnhanced.${setting}`)
    );
  }

  private invalidatePaths(): void {
    this.pathConfigurationGeneration++;
    this.paths = undefined;
    this.lastMissingToolWarning = undefined;
    this.lastRefreshError = undefined;
  }

  private async warnAboutMissingToolchainBinaries(toolchainPath?: string): Promise<void> {
    if (!toolchainPath) {
      this.lastMissingToolWarning = undefined;
      return;
    }

    const missing = await findMissingToolchainBinaries(toolchainPath);
    if (missing.length === 0) {
      this.lastMissingToolWarning = undefined;
      return;
    }

    const message = `STM32 Build Analyzer: configured toolchain directory is missing `
      + `${missing.join(', ')}. Missing tools will be resolved from PATH.`;
    if (message === this.lastMissingToolWarning) {
      return;
    }

    this.lastMissingToolWarning = message;
    vscode.window.showWarningMessage(message);
  }
}
