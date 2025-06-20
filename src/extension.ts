import * as vscode from 'vscode';
import { BuildAnalyzerProvider } from './BuildAnalyzerProvider';

let provider: BuildAnalyzerProvider;

export function activate(context: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration('stm32BuildAnalyzerEnhanced');
  const debug = cfg.get<boolean>('debug') ?? false;

  if (debug) {
    console.log('[STM32 Extension] Activating extension...');
  }

  provider = new BuildAnalyzerProvider(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('stm32BuildAnalyzerEnhanced.refresh', () => {
      if (debug) {console.log('[STM32 Extension] Command: refresh');}
      return provider.refresh();
    }),

    vscode.commands.registerCommand('stm32BuildAnalyzerEnhanced.refreshPaths', () => {
      if (debug) {console.log('[STM32 Extension] Command: refreshPaths');}
      return provider.fullRefresh();
    }),

    vscode.window.registerWebviewViewProvider('buildAnalyzerEnhanced', provider)
  );

  if (debug) {
    console.log('[STM32 Extension] Commands and WebviewViewProvider registered.');
  }
}

export function deactivate() {
  if (provider) {
    provider.dispose();
  }
}
