import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
});
