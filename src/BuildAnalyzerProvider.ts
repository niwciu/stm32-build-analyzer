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

  constructor(private readonly context: vscode.ExtensionContext) {
    this.watcher  = new FileWatcherService(context, () => this.refresh());
    this.resolver = new BuildFolderResolver(context);
    const toolPath = vscode.workspace.getConfiguration('stm32BuildAnalyzerEnhanced')
      .get<string>('toolchainPath', '');
    this.parser   = new MapElfParser(toolPath);
    this.watcher.start();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.renderer = new WebviewRenderer(this.context, view);
    this.renderer.init();
    this.refresh();
  }

  /** Szybki refresh – parsuje przy użyciu zcache’owanych ścieżek */
  public async refresh() {
    try {
      this.paths = this.paths ?? await this.resolver.resolve();
      const regions = this.parser.parse(this.paths.map, this.paths.elf);
      const rel = path.relative(vscode.workspace.workspaceFolders![0].uri.fsPath, this.paths.map);
      this.renderer?.showData(regions, path.dirname(rel));
    } catch (e: any) {
      vscode.window.showErrorMessage(e.message || String(e));
    }
  }

  /** Pełny refresh – czyści cache i wymusza ponowny wybór build folderu */
  public async fullRefresh() {
    this.paths = undefined;
    await this.refresh();
  }

  dispose(): void {
    this.watcher.dispose();
  }
}
