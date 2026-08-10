import * as assert from 'assert';
import { assertCustomBuildPairComplete } from '../utils/customBuildPaths';

suite('custom build paths', () => {
  test('accepts two configured paths', () => {
    assert.doesNotThrow(() =>
      assertCustomBuildPairComplete('firmware.map', 'firmware.elf')
    );
  });

  test('accepts two empty paths', () => {
    assert.doesNotThrow(() => assertCustomBuildPairComplete('', ''));
  });

  test('rejects a MAP path without an ELF path', () => {
    assert.throws(
      () => assertCustomBuildPairComplete('firmware.map', ''),
      /must be configured together/
    );
  });

  test('rejects an ELF path without a MAP path', () => {
    assert.throws(
      () => assertCustomBuildPairComplete(undefined, 'firmware.elf'),
      /must be configured together/
    );
  });
});
