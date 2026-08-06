import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverBuildPairs } from '../utils/buildDiscovery';

suite('build output discovery', () => {
  let root: string;

  setup(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stm32-discovery-'));
  });

  teardown(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  async function writePair(directory: string, stem: string): Promise<void> {
    await fs.promises.mkdir(directory, { recursive: true });
    await Promise.all([
      fs.promises.writeFile(path.join(directory, `${stem}.map`), 'Memory Configuration'),
      fs.promises.writeFile(path.join(directory, `${stem}.elf`), 'ELF'),
    ]);
  }

  test('finds matching outputs in nested directories', async () => {
    const build = path.join(root, 'project', 'build');
    await writePair(build, 'firmware');

    const pairs = await discoverBuildPairs(root);

    assert.deepStrictEqual(pairs, [{
      folder: build,
      map: path.join(build, 'firmware.map'),
      elf: path.join(build, 'firmware.elf'),
      label: 'firmware',
    }]);
  });

  test('ignores unrelated MAP and ELF files', async () => {
    await fs.promises.writeFile(path.join(root, 'application.map'), 'map');
    await fs.promises.writeFile(path.join(root, 'bootloader.elf'), 'elf');

    assert.deepStrictEqual(await discoverBuildPairs(root), []);
  });

  test('ignores empty MAP files', async () => {
    await fs.promises.writeFile(path.join(root, 'firmware.map'), '');
    await fs.promises.writeFile(path.join(root, 'firmware.elf'), 'elf');

    assert.deepStrictEqual(await discoverBuildPairs(root), []);
  });

  test('does not traverse directory symlinks', async function () {
    const outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stm32-outside-'));
    try {
      await writePair(outside, 'external');
      try {
        await fs.promises.symlink(outside, path.join(root, 'linked-build'), 'dir');
      } catch {
        this.skip();
      }

      assert.deepStrictEqual(await discoverBuildPairs(root), []);
    } finally {
      await fs.promises.rm(outside, { recursive: true, force: true });
    }
  });
});
