import * as vscode from 'vscode';

export class FileWatcherService {
  private watcher?: vscode.FileSystemWatcher;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onChange: () => void
  ) {}

  public start(): void {
    this.dispose();

    this.watcher = vscode.workspace.createFileSystemWatcher('**/*.{map,elf}');
    this.context.subscriptions.push(this.watcher);

    const debug = vscode.workspace.getConfiguration('stm32BuildAnalyzerEnhanced').get<boolean>('debug');

    const wrappedHandler = (event: vscode.Uri) => {
      if (debug) {
        console.log(`[STM32 Build Analyzer] File event on: ${event.fsPath}`);
      }
      this.onChange();
    };

    this.disposables.push(
      this.watcher.onDidChange(wrappedHandler),
      this.watcher.onDidCreate(wrappedHandler),
      this.watcher.onDidDelete(wrappedHandler)
    );
  }

  public dispose(): void {
    this.watcher?.dispose();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}

export function deactivate() {}
