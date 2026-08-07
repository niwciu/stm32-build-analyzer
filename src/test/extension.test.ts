import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { BuildAnalyzerProvider } from '../BuildAnalyzerProvider';
import { MapElfParser } from '../services/MapElfParser';
import {
  AnalysisCancelledError,
  UserCancelledError,
} from '../utils/errors';
import {
  ARM_TOOLCHAIN_TOOLS,
  getToolFilename,
} from '../utils/toolchain';

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

  test('named workspace toolchain settings flow through the real resolver and refresh events', async () => {
    const application = vscode.workspace.workspaceFolders
      ?.find(folder => folder.name === 'Application');
    const toolchain = vscode.workspace.workspaceFolders
      ?.find(folder => folder.name === 'Toolchain');
    assert.ok(application, 'Application fixture folder is not open');
    assert.ok(toolchain, 'Toolchain fixture folder is not open');

    const buildDirectory = path.join(application.uri.fsPath, 'build');
    const toolchainDirectory = path.join(toolchain.uri.fsPath, 'bin');
    const additionalRoot = path.join(path.dirname(application.uri.fsPath), 'additional');
    await Promise.all([
      fs.promises.mkdir(buildDirectory, { recursive: true }),
      fs.promises.mkdir(toolchainDirectory, { recursive: true }),
      fs.promises.mkdir(additionalRoot, { recursive: true }),
    ]);
    await Promise.all([
      fs.promises.writeFile(
        path.join(buildDirectory, 'firmware.map'),
        'Memory Configuration\nFLASH 0x08000000 0x1000\nLinker script and memory map\n'
      ),
      fs.promises.writeFile(path.join(buildDirectory, 'firmware.elf'), 'ELF'),
      ...ARM_TOOLCHAIN_TOOLS.map(tool =>
        fs.promises.writeFile(
          path.join(toolchainDirectory, getToolFilename(tool)),
          ''
        )
      ),
    ]);

    const cfg = vscode.workspace.getConfiguration('stm32BuildAnalyzerEnhanced');
    const settings = ['mapFilePath', 'elfFilePath', 'toolchainPath'] as const;
    const previous = new Map(
      settings.map(setting => [
        setting,
        cfg.inspect<string>(setting)?.workspaceValue,
      ])
    );
    await cfg.update(
      'mapFilePath',
      '${workspaceFolder:Application}/build/firmware.map',
      vscode.ConfigurationTarget.Workspace
    );
    await cfg.update(
      'elfFilePath',
      '${workspaceFolder:Application}/build/firmware.elf',
      vscode.ConfigurationTarget.Workspace
    );
    await cfg.update(
      'toolchainPath',
      '${workspaceFolder:Toolchain}/bin',
      vscode.ConfigurationTarget.Workspace
    );

    const subscriptions: vscode.Disposable[] = [];
    const context = { subscriptions } as unknown as vscode.ExtensionContext;
    const toolchainPaths: string[] = [];
    const provider = new BuildAnalyzerProvider(
      context,
      (toolchainPath: string) => {
        toolchainPaths.push(toolchainPath);
        return {
          warnings: [],
          parse: async () => [],
        } as unknown as MapElfParser;
      }
    );
    (provider as any).renderer = {
      showData: () => undefined,
      showError: () => undefined,
    };
    let addedWorkspaceFolder = false;

    const waitForParserCalls = async (expected: number): Promise<void> => {
      const deadline = Date.now() + 3000;
      while (toolchainPaths.length < expected && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.strictEqual(toolchainPaths.length, expected);
    };

    try {
      await provider.refresh();
      assert.strictEqual(toolchainPaths[0], toolchainDirectory);

      await cfg.update(
        'toolchainPath',
        '',
        vscode.ConfigurationTarget.Workspace
      );
      await waitForParserCalls(2);
      assert.strictEqual(toolchainPaths[1], '');

      const folderCount = vscode.workspace.workspaceFolders?.length ?? 0;
      addedWorkspaceFolder = vscode.workspace.updateWorkspaceFolders(
        folderCount,
        0,
        { uri: vscode.Uri.file(additionalRoot), name: 'Additional' }
      );
      assert.ok(addedWorkspaceFolder, 'Additional fixture folder was not added');
      await waitForParserCalls(3);
      assert.strictEqual(toolchainPaths[2], '');
    } finally {
      provider.dispose();
      subscriptions.forEach(disposable => disposable.dispose());
      if (addedWorkspaceFolder) {
        const index = vscode.workspace.workspaceFolders
          ?.findIndex(folder => folder.name === 'Additional') ?? -1;
        if (index >= 0) {
          vscode.workspace.updateWorkspaceFolders(index, 1);
        }
      }
      for (const setting of settings) {
        await cfg.update(
          setting,
          previous.get(setting),
          vscode.ConfigurationTarget.Workspace
        );
      }
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

  test('a superseded refresh cannot publish an outdated toolchain warning', async () => {
    const subscriptions: vscode.Disposable[] = [];
    const context = { subscriptions } as unknown as vscode.ExtensionContext;
    let completeMissingBinaryCheck: ((missing: string[]) => void) | undefined;
    let markMissingBinaryCheckStarted: (() => void) | undefined;
    const missingBinaryCheckStarted = new Promise<void>(resolve => {
      markMissingBinaryCheckStarted = resolve;
    });
    const provider = new BuildAnalyzerProvider(
      context,
      () => ({
        warnings: [],
        parse: async () => [],
      } as unknown as MapElfParser),
      async () => {
        markMissingBinaryCheckStarted?.();
        return new Promise<string[]>(resolve => {
          completeMissingBinaryCheck = resolve;
        });
      }
    );
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    (provider as any).resolver = {
      resolve: async () => ({
        map: `${root}/build/firmware.map`,
        elf: `${root}/build/firmware.elf`,
        toolchainPath: `${root}/old-toolchain`,
      }),
      resolveToolchainPath: async () => undefined,
    };
    (provider as any).renderer = {
      showData: () => undefined,
      showError: () => undefined,
    };

    try {
      const first = provider.refresh();
      await missingBinaryCheckStarted;
      const second = provider.refresh();
      completeMissingBinaryCheck?.(['arm-none-eabi-objdump']);

      const outcomes = await Promise.all([first, second]);

      assert.deepStrictEqual(outcomes, ['superseded', 'success']);
      assert.strictEqual((provider as any).lastMissingToolWarning, undefined);
    } finally {
      provider.dispose();
      subscriptions.forEach(disposable => disposable.dispose());
    }
  });
});
