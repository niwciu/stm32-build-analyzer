import * as vscode from 'vscode';
import { BuildAnalyzerProvider } from './BuildAnalyzerProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new BuildAnalyzerProvider(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('stm32BuildAnalyzerEnhanced.refresh', () =>
      provider.refresh()
    ),
    vscode.commands.registerCommand('stm32BuildAnalyzerEnhanced.refreshPaths', () =>
      provider.fullRefresh()
    ),
    vscode.window.registerWebviewViewProvider(
      'buildAnalyzerEnhanced',
      provider
    )
  );
}

export function deactivate() {}
