import * as assert from 'assert';
import {
  isSelectedBuildFile,
  normalizeWatchedFile,
} from '../utils/watchedFiles';

suite('watched build files', () => {
  test('matches an exact extensionless selected output', () => {
    const selected = new Set(['/workspace/build/firmware']);
    assert.ok(isSelectedBuildFile('/workspace/build/firmware', selected, 'linux'));
  });

  test('matches a manually selected .out file', () => {
    const selected = new Set(['/workspace/build/firmware.out']);
    assert.ok(isSelectedBuildFile('/workspace/build/firmware.out', selected, 'linux'));
  });

  test('does not refresh for another file in the selected directory', () => {
    const selected = new Set(['/workspace/build/firmware.out']);
    assert.ok(!isSelectedBuildFile('/workspace/build/notes.txt', selected, 'linux'));
  });

  test('normalizes Windows paths case-insensitively', () => {
    const selected = new Set([
      normalizeWatchedFile('D:\\Build\\Firmware.ELF', 'win32'),
    ]);
    assert.ok(isSelectedBuildFile('d:\\build\\firmware.elf', selected, 'win32'));
  });
});
