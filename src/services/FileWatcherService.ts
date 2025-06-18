import * as vscode from 'vscode';

export class FileWatcherService {
  private watcher?: vscode.FileSystemWatcher;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onChange: () => void
  ) {}

  public start(): void {
    this.dispose();
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*.{map,elf}');
    this.watcher.onDidChange(this.onChange);
    this.context.subscriptions.push(this.watcher);
  }

  public dispose(): void {
    this.watcher?.dispose();
  }
}
