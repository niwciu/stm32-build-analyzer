import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BuildFolderResolver } from '../services/BuildFolderResolver';
import {
  getManualBuildPairsForTarget,
  ManualBuildPair,
  validateRequiredPath,
} from '../utils/manualBuildPairs';

suite('manual build pair settings', () => {
  const globalPair: ManualBuildPair = {
    folder: 'global',
    map: 'global.map',
    elf: 'global.elf',
  };
  const workspacePair: ManualBuildPair = {
    folder: 'workspace',
    map: 'workspace.map',
    elf: 'workspace.elf',
  };

  async function withWorkspaceBuildConfiguration<T>(
    manualPairs: ManualBuildPair[],
    run: () => Promise<T>
  ): Promise<T> {
    const cfg = vscode.workspace.getConfiguration('stm32BuildAnalyzerEnhanced');
    const settings = ['mapFilePath', 'elfFilePath', 'manualBuildPairs'] as const;
    const previous = new Map(
      settings.map(setting => [
        setting,
        cfg.inspect(setting)?.workspaceValue,
      ])
    );

    try {
      await cfg.update('mapFilePath', '', vscode.ConfigurationTarget.Workspace);
      await cfg.update('elfFilePath', '', vscode.ConfigurationTarget.Workspace);
      await cfg.update(
        'manualBuildPairs',
        manualPairs,
        vscode.ConfigurationTarget.Workspace
      );
      return await run();
    } finally {
      for (const setting of settings) {
        await cfg.update(
          setting,
          previous.get(setting),
          vscode.ConfigurationTarget.Workspace
        );
      }
    }
  }

  test('uses only the user value when updating User settings', () => {
    assert.deepStrictEqual(
      getManualBuildPairsForTarget({
        defaultValue: [],
        globalValue: [globalPair],
        workspaceValue: [workspacePair],
      }, 'user'),
      [globalPair]
    );
  });

  test('uses the workspace value when a workspace override exists', () => {
    assert.deepStrictEqual(
      getManualBuildPairsForTarget({
        defaultValue: [],
        globalValue: [globalPair],
        workspaceValue: [workspacePair],
      }, 'workspace'),
      [workspacePair]
    );
  });

  test('preserves visible user pairs when creating a workspace value', () => {
    assert.deepStrictEqual(
      getManualBuildPairsForTarget({
        defaultValue: [],
        globalValue: [globalPair],
      }, 'workspace'),
      [globalPair]
    );
  });

  test('does not expose the stored configuration arrays for mutation', () => {
    const configured = [globalPair];
    const selected = getManualBuildPairsForTarget(
      { globalValue: configured },
      'user'
    );

    selected.push(workspacePair);

    assert.deepStrictEqual(configured, [globalPair]);
  });

  test('rejects empty and whitespace-only paths', () => {
    assert.strictEqual(
      validateRequiredPath(''),
      'A non-empty path is required.'
    );
    assert.strictEqual(
      validateRequiredPath('   '),
      'A non-empty path is required.'
    );
    assert.strictEqual(validateRequiredPath('build/firmware.map'), undefined);
  });

  test('keeps built manual pairs available when other configured outputs are missing', async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'stm32-manual-pairs-')
    );
    const availableFolder = path.join(root, 'product-12', 'release');
    await fs.promises.mkdir(availableFolder, { recursive: true });
    await Promise.all([
      fs.promises.writeFile(
        path.join(availableFolder, 'firmware.map'),
        'Memory Configuration\nFLASH 0x08000000 0x1000\n'
      ),
      fs.promises.writeFile(path.join(availableFolder, 'firmware.out'), 'ELF'),
    ]);

    const pairs: ManualBuildPair[] = Array.from({ length: 18 }, (_, index) => ({
      label: `Product ${index + 1}`,
      folder: `product-${index + 1}/release`,
      map: 'firmware.map',
      elf: 'firmware.out',
    }));

    try {
      const resolver = new BuildFolderResolver();
      const resolved = await (resolver as any).resolveManualPairs(root, pairs);

      assert.strictEqual(resolved.available.length, 1);
      assert.strictEqual(resolved.unavailable.length, 17);
      assert.strictEqual(resolved.available[0].label, 'Product 12');
      assert.strictEqual(
        resolved.available[0].map,
        path.join(availableFolder, 'firmware.map')
      );
      assert.strictEqual(
        resolved.available[0].elf,
        path.join(availableFolder, 'firmware.out')
      );
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  test('still rejects manual pairs with missing required fields', async () => {
    const resolver = new BuildFolderResolver();
    const invalidPair = {
      label: 'Invalid',
      folder: 'build',
      map: '',
      elf: 'firmware.elf',
    };

    await assert.rejects(
      (resolver as any).resolveManualPairs(process.cwd(), [invalidPair]),
      /manualBuildPairs entry "Invalid" must define folder, map, and elf/
    );
  });

  test('still rejects unresolved variables in manual pair paths', async () => {
    const resolver = new BuildFolderResolver();
    const unresolvedPair: ManualBuildPair = {
      label: 'Unresolved',
      folder: '${env:STM32_BUILD_ANALYZER_MISSING_TEST_VAR}',
      map: 'firmware.map',
      elf: 'firmware.elf',
    };

    await assert.rejects(
      (resolver as any).resolveManualPairs(process.cwd(), [unresolvedPair]),
      /contains unresolved variable.*STM32_BUILD_ANALYZER_MISSING_TEST_VAR/
    );
  });

  test('resolves variables in available manual pair paths', async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'stm32-variable-manual-pair-')
    );
    const outputFolder = path.join(root, 'variable-output');
    const variableName = 'STM32_BUILD_ANALYZER_MANUAL_PAIR_TEST_ROOT';
    const previousValue = process.env[variableName];
    await fs.promises.mkdir(outputFolder, { recursive: true });
    await Promise.all([
      fs.promises.writeFile(path.join(outputFolder, 'firmware.map'), 'MAP'),
      fs.promises.writeFile(path.join(outputFolder, 'firmware.out'), 'ELF'),
    ]);
    process.env[variableName] = root;

    try {
      const resolver = new BuildFolderResolver();
      const resolved = await (resolver as any).resolveManualPairs(root, [{
        label: 'Variable paths',
        folder: path.join(`\${env:${variableName}}`, 'variable-output'),
        map: 'firmware.map',
        elf: 'firmware.out',
      }]);

      assert.deepStrictEqual(resolved.unavailable, []);
      assert.deepStrictEqual(resolved.available, [{
        folder: outputFolder,
        map: path.join(outputFolder, 'firmware.map'),
        elf: path.join(outputFolder, 'firmware.out'),
        label: 'Variable paths',
      }]);
    } finally {
      if (previousValue === undefined) {
        delete process.env[variableName];
      } else {
        process.env[variableName] = previousValue;
      }
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  test('continues to automatic discovery when manual outputs are unavailable', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(root, 'Workspace fixture is not open');
    const unavailablePair: ManualBuildPair = {
      label: 'Unbuilt manual output',
      folder: path.join(root, 'missing-manual-output'),
      map: 'firmware.map',
      elf: 'firmware.out',
    };
    const automaticPair = {
      folder: path.join(root, 'automatic-output'),
      map: path.join(root, 'automatic-output', 'firmware.map'),
      elf: path.join(root, 'automatic-output', 'firmware.elf'),
      label: 'firmware',
    };

    await withWorkspaceBuildConfiguration([unavailablePair], async () => {
      const resolver = new BuildFolderResolver();
      (resolver as any).findBuildPairs = async () => [automaticPair];
      (resolver as any).resolveToolchainPath = async () => undefined;

      const resolved = await resolver.resolve();

      assert.strictEqual(resolved.map, automaticPair.map);
      assert.strictEqual(resolved.elf, automaticPair.elf);
    });
  });

  test('selects an available manual output while another remains unbuilt', async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, 'Workspace fixture is not open');
    const root = await fs.promises.mkdtemp(
      path.join(workspaceRoot, 'manual-selection-')
    );
    const availableFolder = path.join(root, 'built');
    await fs.promises.mkdir(availableFolder, { recursive: true });
    await Promise.all([
      fs.promises.writeFile(path.join(availableFolder, 'firmware.map'), 'MAP'),
      fs.promises.writeFile(path.join(availableFolder, 'firmware.out'), 'ELF'),
    ]);
    const pairs: ManualBuildPair[] = [
      {
        label: 'Built output',
        folder: availableFolder,
        map: 'firmware.map',
        elf: 'firmware.out',
      },
      {
        label: 'Unbuilt output',
        folder: path.join(root, 'unbuilt'),
        map: 'firmware.map',
        elf: 'firmware.out',
      },
    ];

    try {
      await withWorkspaceBuildConfiguration(pairs, async () => {
        const resolver = new BuildFolderResolver();
        (resolver as any).findBuildPairs = async () => [];
        (resolver as any).resolveToolchainPath = async () => undefined;

        const resolved = await resolver.resolve();

        assert.strictEqual(
          resolved.map,
          path.join(availableFolder, 'firmware.map')
        );
        assert.strictEqual(
          resolved.elf,
          path.join(availableFolder, 'firmware.out')
        );
      });
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  test('reports unavailable manual outputs when no build can be selected', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(root, 'Workspace fixture is not open');
    const folder = path.join(root, 'missing-only-output');
    const unavailablePair: ManualBuildPair = {
      label: 'Only configured output',
      folder,
      map: 'only.map',
      elf: 'only.out',
    };

    await withWorkspaceBuildConfiguration([unavailablePair], async () => {
      const resolver = new BuildFolderResolver();
      (resolver as any).findBuildPairs = async () => [];

      await assert.rejects(
        resolver.resolve(),
        error => {
          const message = error instanceof Error ? error.message : String(error);
          return message.includes('Configured manual pairs are currently unavailable')
            && message.includes('Only configured output')
            && message.includes(path.join(folder, 'only.map'))
            && message.includes(path.join(folder, 'only.out'));
        }
      );
    });
  });

  test('tracks whichever file is missing from each manual pair', async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'stm32-partial-manual-pairs-')
    );
    const mapOnlyFolder = path.join(root, 'map-only');
    const elfOnlyFolder = path.join(root, 'elf-only');
    await Promise.all([
      fs.promises.mkdir(mapOnlyFolder, { recursive: true }),
      fs.promises.mkdir(elfOnlyFolder, { recursive: true }),
    ]);
    await Promise.all([
      fs.promises.writeFile(path.join(mapOnlyFolder, 'firmware.map'), 'MAP'),
      fs.promises.writeFile(path.join(elfOnlyFolder, 'firmware.out'), 'ELF'),
    ]);
    const pairs: ManualBuildPair[] = [
      {
        label: 'Missing ELF',
        folder: mapOnlyFolder,
        map: 'firmware.map',
        elf: 'firmware.out',
      },
      {
        label: 'Missing MAP',
        folder: elfOnlyFolder,
        map: 'firmware.map',
        elf: 'firmware.out',
      },
    ];

    try {
      const resolver = new BuildFolderResolver();
      const resolved = await (resolver as any).resolveManualPairs(root, pairs);

      assert.deepStrictEqual(resolved.available, []);
      assert.deepStrictEqual(resolved.unavailable, [
        {
          entryName: 'Missing ELF',
          missingPaths: [path.join(mapOnlyFolder, 'firmware.out')],
        },
        {
          entryName: 'Missing MAP',
          missingPaths: [path.join(elfOnlyFolder, 'firmware.map')],
        },
      ]);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});
