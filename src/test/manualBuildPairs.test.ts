import * as assert from 'assert';
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
});
