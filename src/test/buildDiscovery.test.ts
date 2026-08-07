import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  discoverBuildPairs,
  discoverBuildPairsInRoots,
} from '../utils/buildDiscovery';
import { AnalysisCancelledError } from '../utils/errors';

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

  test('finds firmware outputs in a directory named out', async () => {
    const output = path.join(root, 'project', 'out');
    await writePair(output, 'firmware');

    const pairs = await discoverBuildPairs(root);

    assert.strictEqual(pairs.length, 1);
    assert.strictEqual(pairs[0].folder, output);
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

  test('discovers outputs from every workspace root', async () => {
    const applicationRoot = path.join(root, 'application');
    const bootloaderRoot = path.join(root, 'bootloader');
    await writePair(path.join(applicationRoot, 'build'), 'application');
    await writePair(path.join(bootloaderRoot, 'build'), 'bootloader');

    const pairs = await discoverBuildPairsInRoots([applicationRoot, bootloaderRoot]);

    assert.deepStrictEqual(
      pairs.map(pair => pair.label).sort(),
      ['application', 'bootloader']
    );
  });

  test('deduplicates outputs when workspace roots overlap', async () => {
    const projectRoot = path.join(root, 'project');
    const buildRoot = path.join(projectRoot, 'build');
    await writePair(buildRoot, 'firmware');

    const pairs = await discoverBuildPairsInRoots([projectRoot, buildRoot]);

    assert.strictEqual(pairs.length, 1);
    assert.strictEqual(pairs[0].map, path.join(buildRoot, 'firmware.map'));
  });

  test('stops discovery when its refresh is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      discoverBuildPairs(root, undefined, controller.signal),
      AnalysisCancelledError
    );
  });
});
