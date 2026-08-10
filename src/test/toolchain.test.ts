import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findMissingToolchainBinaries,
  getToolFilename,
} from '../utils/toolchain';

suite('toolchain utilities', () => {
  suite('getToolFilename', () => {
    test('adds an .exe suffix on Windows', () => {
      assert.strictEqual(
        getToolFilename('arm-none-eabi-objdump', 'win32'),
        'arm-none-eabi-objdump.exe'
      );
    });

    test('does not add a suffix on Linux', () => {
      assert.strictEqual(
        getToolFilename('arm-none-eabi-objdump', 'linux'),
        'arm-none-eabi-objdump'
      );
    });
  });

  suite('findMissingToolchainBinaries', () => {
    let tempDir: string;

    setup(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stm32-toolchain-test-'));
    });

    teardown(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('reports both required Windows binaries when absent', async () => {
      const missing = await findMissingToolchainBinaries(tempDir, 'win32');

      assert.deepStrictEqual(missing, [
        'arm-none-eabi-objdump.exe',
        'arm-none-eabi-nm.exe',
      ]);
    });

    test('reports only the binary that is absent', async () => {
      fs.writeFileSync(path.join(tempDir, 'arm-none-eabi-objdump'), '');

      const missing = await findMissingToolchainBinaries(tempDir, 'linux');

      assert.deepStrictEqual(missing, ['arm-none-eabi-nm']);
    });

    test('returns an empty list when both binaries exist', async () => {
      fs.writeFileSync(path.join(tempDir, 'arm-none-eabi-objdump'), '');
      fs.writeFileSync(path.join(tempDir, 'arm-none-eabi-nm'), '');

      const missing = await findMissingToolchainBinaries(tempDir, 'linux');

      assert.deepStrictEqual(missing, []);
    });
  });
});
