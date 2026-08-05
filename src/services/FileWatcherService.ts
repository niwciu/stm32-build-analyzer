import * as vscode from 'vscode';

export class FileWatcherService {
  private watcher?: vscode.FileSystemWatcher;
  private disposables: vscode.Disposable[] = [];
  private refreshTimer?: NodeJS.Timeout;
  private readonly debounceMs = 300;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onChange: () => void
  ) {}

  public start(): void {
    this.dispose();

    this.watcher = vscode.workspace.createFileSystemWatcher('**/*.{map,elf}');
    this.context.subscriptions.push(this.watcher);

    const wrappedHandler = (event: vscode.Uri) => {
      if (vscode.workspace
        .getConfiguration('stm32BuildAnalyzerEnhanced')
        .get<boolean>('debug')) {
        console.log(`[STM32 Build Analyzer] File event on: ${event.fsPath}`);
      }
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
      }
      this.refreshTimer = setTimeout(() => {
        this.onChange();
      }, this.debounceMs);
    };

    this.disposables.push(
      this.watcher.onDidChange(wrappedHandler),
      this.watcher.onDidCreate(wrappedHandler),
      this.watcher.onDidDelete(wrappedHandler)
    );
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.watcher?.dispose();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}

export function deactivate() {}
