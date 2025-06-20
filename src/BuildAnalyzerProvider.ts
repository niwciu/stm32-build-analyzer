import * as vscode from 'vscode';
import * as path from 'path';
import { FileWatcherService } from './services/FileWatcherService';
import { BuildFolderResolver, BuildPaths } from './services/BuildFolderResolver';
import { MapElfParser } from './services/MapElfParser';
import { WebviewRenderer } from './ui/WebviewRenderer';

export class BuildAnalyzerProvider implements vscode.WebviewViewProvider {
  private watcher: FileWatcherService;
  private resolver: BuildFolderResolver;
  private parser: MapElfParser;
  private renderer?: WebviewRenderer;
  private paths?: BuildPaths;
  private readonly debug: boolean;

  constructor(private readonly context: vscode.ExtensionContext) {
    const cfg = vscode.workspace.getConfiguration('stm32BuildAnalyzerEnhanced');
    this.debug = cfg.get<boolean>('debug') ?? false;

    this.watcher  = new FileWatcherService(context, () => this.refresh());
    this.resolver = new BuildFolderResolver(context);
    const toolPath = cfg.get<string>('toolchainPath', '');
    this.parser   = new MapElfParser(toolPath, this.debug);

    this.watcher.start();

    if (this.debug) {
      console.log('[STM32 Provider] Initialized with toolchain path:', toolPath);
    }
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

      this.paths = this.paths ?? await this.resolver.resolve();

      if (!this.paths.map || !this.paths.elf) {
        throw new Error('Missing required build paths.');
      }

      const regions = this.parser.parse(this.paths.map, this.paths.elf);

      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        throw new Error('No workspace open to resolve relative paths');
      }

      const rel = path.relative(root, this.paths.map);

      this.renderer?.showData(regions, path.dirname(rel));

      if (this.debug) {
        console.log(`[STM32 Provider] Parsed ${regions.length} region(s)`);
      }

    } catch (e: any) {
      vscode.window.showErrorMessage(e.message || String(e));
      if (this.debug) {
        console.error('[STM32 Provider] Error during refresh:', e);
      }
    }
  }

  /** Full refresh – clears cache and forces reselection of build folder */
  public async fullRefresh() {
    if (this.debug) {console.log('[STM32 Provider] Full refresh requested.');}
    this.paths = undefined;
    await this.refresh();
  }

  dispose(): void {
    this.watcher.dispose();
    if (this.debug) {console.log('[STM32 Provider] Disposed.');}
  }
}
