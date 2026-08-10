import * as vscode from 'vscode';
import * as path from 'path';
import {
  isSelectedBuildFile,
  normalizeWatchedFile,
} from '../utils/watchedFiles';

export class FileWatcherService {
  private discoveryWatchers: vscode.FileSystemWatcher[] = [];
  private selectedPathWatchers: vscode.FileSystemWatcher[] = [];
  private discoveryDisposables: vscode.Disposable[] = [];
  private selectedPathDisposables: vscode.Disposable[] = [];
  private selectedPaths = new Set<string>();
  private refreshTimer?: NodeJS.Timeout;
  private readonly debounceMs = 300;

  constructor(private readonly onChange: () => void) {}

  public start(): void {
    this.dispose();

    this.discoveryWatchers = [
      vscode.workspace.createFileSystemWatcher('**/*.[mM][aA][pP]'),
      vscode.workspace.createFileSystemWatcher('**/*.[eE][lL][fF]'),
    ];
    this.discoveryWatchers.forEach(watcher =>
      this.registerWatcher(watcher, () => true, this.discoveryDisposables)
    );
  }

  public watchFiles(filePaths: readonly string[]): void {
    const nextPaths = new Set(filePaths.map(file => normalizeWatchedFile(file)));
    if (
      nextPaths.size === this.selectedPaths.size
      && [...nextPaths].every(file => this.selectedPaths.has(file))
    ) {
      return;
    }

    this.selectedPathDisposables.forEach(disposable => disposable.dispose());
    this.selectedPathDisposables = [];
    this.selectedPathWatchers.forEach(watcher => watcher.dispose());
    this.selectedPathWatchers = [];
    this.selectedPaths = nextPaths;

    const directories = [...new Set(filePaths.map(file => path.dirname(file)))];
    directories.forEach(directory => {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(directory, '*')
      );
      this.selectedPathWatchers.push(watcher);
      this.registerWatcher(
        watcher,
        event => isSelectedBuildFile(event.fsPath, this.selectedPaths),
        this.selectedPathDisposables
      );
    });
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.discoveryWatchers.forEach(watcher => watcher.dispose());
    this.selectedPathWatchers.forEach(watcher => watcher.dispose());
    this.discoveryWatchers = [];
    this.selectedPathWatchers = [];
    this.selectedPaths.clear();
    this.discoveryDisposables.forEach(disposable => disposable.dispose());
    this.selectedPathDisposables.forEach(disposable => disposable.dispose());
    this.discoveryDisposables = [];
    this.selectedPathDisposables = [];
  }

  private registerWatcher(
    watcher: vscode.FileSystemWatcher,
    shouldRefresh: (event: vscode.Uri) => boolean,
    disposables: vscode.Disposable[]
  ): void {
    const wrappedHandler = (event: vscode.Uri) => {
      if (!shouldRefresh(event)) {
        return;
      }
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

    disposables.push(
      watcher.onDidChange(wrappedHandler),
      watcher.onDidCreate(wrappedHandler),
      watcher.onDidDelete(wrappedHandler)
    );
  }
}

export function deactivate() {}
