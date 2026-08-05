import * as assert from 'assert';
import * as vscode from 'vscode';
import { BuildAnalyzerProvider } from '../BuildAnalyzerProvider';
import { MapElfParser } from '../services/MapElfParser';

suite('Extension', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('niwciu.stm32-build-analyzer-enhanced');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('all commands are registered', async () => {
    const allCommands = await vscode.commands.getCommands(true);
    const expected = [
      'stm32BuildAnalyzerEnhanced.openTab',
      'stm32BuildAnalyzerEnhanced.refresh',
      'stm32BuildAnalyzerEnhanced.refreshPaths',
      'stm32BuildAnalyzerEnhanced.addManualPair',
    ];
    for (const cmd of expected) {
      assert.ok(allCommands.includes(cmd), `Command not registered: ${cmd}`);
    }
  });

  test('provider passes the resolved toolchain path to the parser and resets it when cleared', async () => {
    const subscriptions: vscode.Disposable[] = [];
    const context = { subscriptions } as unknown as vscode.ExtensionContext;
    const toolchainPaths: string[] = [];
    const parserFactory = (toolchainPath: string): MapElfParser => {
      toolchainPaths.push(toolchainPath);
      return { parse: () => [] } as unknown as MapElfParser;
    };
    const provider = new BuildAnalyzerProvider(context, parserFactory);
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    let resolvedToolchainPath: string | undefined = `${root}/resolved-toolchain`;

    (provider as any).resolver = {
      resolve: async () => ({
        map: `${root}/build/firmware.map`,
        elf: `${root}/build/firmware.elf`,
        toolchainPath: resolvedToolchainPath,
      }),
    };
    (provider as any).renderer = { showData: () => undefined };

    try {
      await provider.refresh();
      resolvedToolchainPath = undefined;
      await provider.fullRefresh();

      assert.deepStrictEqual(toolchainPaths, [`${root}/resolved-toolchain`, '']);
    } finally {
      provider.dispose();
      subscriptions.forEach(disposable => disposable.dispose());
    }
  });
});
