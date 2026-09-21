import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverLinkerScriptPaths } from '../artifacts/LinkerScriptDiscovery';

suite('linker script discovery', () => {
  let temporaryDirectory: string;
  let root: string;

  setup(async () => {
    temporaryDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'stm32-linker-scripts-')
    );
    root = path.join(temporaryDirectory, 'workspace');
    await fs.promises.mkdir(root);
  });

  teardown(async () => {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('finds the nearest single MEMORY script', async () => {
    const build = path.join(root, 'build', 'debug');
    await fs.promises.mkdir(build, { recursive: true });
    const script = path.join(root, 'linker.ld');
    await fs.promises.writeFile(script, 'MEMORY { FLASH : ORIGIN = 0, LENGTH = 1K }');

    const found = await discoverLinkerScriptPaths(
      path.join(build, 'firmware.map'),
      path.join(build, 'firmware.elf'),
      root
    );

    assert.deepStrictEqual(found, [script]);
  });

  test('prefers a script matching the build artifact basename', async () => {
    const build = path.join(root, 'build');
    await fs.promises.mkdir(build);
    const selected = path.join(build, 'firmware.ld');
    await Promise.all([
      fs.promises.writeFile(selected, 'MEMORY { FLASH : ORIGIN = 0, LENGTH = 1K }'),
      fs.promises.writeFile(
        path.join(build, 'bootloader.ld'),
        'MEMORY { FLASH : ORIGIN = 0, LENGTH = 1K }'
      ),
    ]);

    const found = await discoverLinkerScriptPaths(
      path.join(build, 'firmware.map'),
      path.join(build, 'firmware.elf'),
      root
    );

    assert.deepStrictEqual(found, [selected]);
  });

  test('does not guess between ambiguous scripts', async () => {
    const build = path.join(root, 'build');
    await fs.promises.mkdir(build);
    await Promise.all([
      fs.promises.writeFile(
        path.join(build, 'first.ld'),
        'MEMORY { FLASH : ORIGIN = 0, LENGTH = 1K }'
      ),
      fs.promises.writeFile(
        path.join(build, 'second.ld'),
        'MEMORY { RAM : ORIGIN = 0, LENGTH = 1K }'
      ),
    ]);

    const found = await discoverLinkerScriptPaths(
      path.join(build, 'firmware.map'),
      path.join(build, 'firmware.elf'),
      root
    );

    assert.deepStrictEqual(found, []);
  });

  test('ignores scripts without MEMORY declarations and never leaves the workspace', async () => {
    const build = path.join(root, 'build');
    await fs.promises.mkdir(build);
    await Promise.all([
      fs.promises.writeFile(path.join(build, 'sections.ld'), 'SECTIONS { .text : {} }'),
      fs.promises.writeFile(
        path.join(temporaryDirectory, 'outside.ld'),
        'MEMORY { FLASH : ORIGIN = 0, LENGTH = 1K }'
      ),
    ]);

    const found = await discoverLinkerScriptPaths(
      path.join(build, 'firmware.map'),
      path.join(build, 'firmware.elf'),
      root
    );

    assert.deepStrictEqual(found, []);
  });
});
