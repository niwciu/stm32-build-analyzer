import * as assert from 'assert';
import * as vscode from 'vscode';
import { BuildAnalyzerProvider } from '../BuildAnalyzerProvider';
import { MapElfParser } from '../services/MapElfParser';
import {
  AnalysisCancelledError,
  UserCancelledError,
} from '../utils/errors';

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

  test('provider refreshes the toolchain without resolving the build pair again', async () => {
    const subscriptions: vscode.Disposable[] = [];
    const context = { subscriptions } as unknown as vscode.ExtensionContext;
    const toolchainPaths: string[] = [];
    let buildPathResolutions = 0;
    const parserFactory = (toolchainPath: string): MapElfParser => {
      toolchainPaths.push(toolchainPath);
      return { parse: () => [] } as unknown as MapElfParser;
    };
    const provider = new BuildAnalyzerProvider(context, parserFactory);
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    let resolvedToolchainPath: string | undefined = `${root}/resolved-toolchain`;

    (provider as any).resolver = {
      resolve: async () => {
        buildPathResolutions++;
        return {
          map: `${root}/build/firmware.map`,
          elf: `${root}/build/firmware.elf`,
          toolchainPath: resolvedToolchainPath,
        };
      },
      resolveToolchainPath: async () => resolvedToolchainPath,
    };
    (provider as any).renderer = {
      showData: () => undefined,
      showError: () => undefined,
    };

    try {
      await provider.refresh();
      resolvedToolchainPath = undefined;
      await provider.refresh();

      assert.deepStrictEqual(toolchainPaths, [`${root}/resolved-toolchain`, '']);
      assert.strictEqual(buildPathResolutions, 1);
    } finally {
      provider.dispose();
      subscriptions.forEach(disposable => disposable.dispose());
    }
  });

  test('provider clears stale webview data and exposes refresh failures', async () => {
    const subscriptions: vscode.Disposable[] = [];
    const context = { subscriptions } as unknown as vscode.ExtensionContext;
    const provider = new BuildAnalyzerProvider(
      context,
      () => ({
        parse: () => {
          throw new Error('objdump failed for test');
        },
      } as unknown as MapElfParser)
    );
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    let shownData = false;
    let shownError: string | undefined;

    (provider as any).resolver = {
      resolve: async () => ({
        map: `${root}/build/firmware.map`,
        elf: `${root}/build/firmware.elf`,
      }),
      resolveToolchainPath: async () => undefined,
    };
    (provider as any).renderer = {
      showData: () => { shownData = true; },
      showError: (message: string) => { shownError = message; },
    };

    try {
      await provider.refresh();

      assert.strictEqual(shownData, false);
      assert.strictEqual(shownError, 'objdump failed for test');
    } finally {
      provider.dispose();
      subscriptions.forEach(disposable => disposable.dispose());
    }
  });

  test('cancelling build selection keeps the previous paths without showing an error', async () => {
    const subscriptions: vscode.Disposable[] = [];
    const context = { subscriptions } as unknown as vscode.ExtensionContext;
    const provider = new BuildAnalyzerProvider(context);
    const previousPaths = {
      map: '/workspace/build/previous.map',
      elf: '/workspace/build/previous.elf',
      toolchainPath: '/toolchain/bin',
    };
    let shownError: string | undefined;

    (provider as any).paths = previousPaths;
    (provider as any).resolver = {
      resolve: async () => {
        throw new UserCancelledError('Build output selection cancelled');
      },
    };
    (provider as any).renderer = {
      showData: () => undefined,
      showError: (message: string) => { shownError = message; },
    };

    try {
      await provider.fullRefresh();

      assert.strictEqual((provider as any).paths, previousPaths);
      assert.strictEqual(shownError, undefined);
    } finally {
      provider.dispose();
      subscriptions.forEach(disposable => disposable.dispose());
    }
  });

  test('a newer refresh cancels an older parser run silently', async () => {
    const subscriptions: vscode.Disposable[] = [];
    const context = { subscriptions } as unknown as vscode.ExtensionContext;
    let parserCalls = 0;
    let shownData = 0;
    let shownError = 0;
    const provider = new BuildAnalyzerProvider(
      context,
      () => ({
        warnings: [],
        parse: async (
          _map: string,
          _elf: string,
          signal?: AbortSignal
        ) => {
          parserCalls++;
          if (parserCalls === 1) {
            await new Promise<void>((_resolve, reject) => {
              signal?.addEventListener(
                'abort',
                () => reject(new AnalysisCancelledError()),
                { once: true }
              );
            });
          }
          return [];
        },
      } as unknown as MapElfParser)
    );
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    (provider as any).resolver = {
      resolve: async () => ({
        map: `${root}/build/firmware.map`,
        elf: `${root}/build/firmware.elf`,
      }),
      resolveToolchainPath: async () => undefined,
    };
    (provider as any).renderer = {
      showData: () => { shownData++; },
      showError: () => { shownError++; },
    };

    try {
      const first = provider.refresh();
      await new Promise(resolve => setTimeout(resolve, 0));
      const second = provider.refresh();
      const outcomes = await Promise.all([first, second]);

      assert.deepStrictEqual(outcomes, ['superseded', 'success']);
      assert.strictEqual(shownData, 1);
      assert.strictEqual(shownError, 0);
    } finally {
      provider.dispose();
      subscriptions.forEach(disposable => disposable.dispose());
    }
  });
});
