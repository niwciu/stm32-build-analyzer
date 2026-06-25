import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MapElfParser } from '../services/MapElfParser';

const SAMPLE_MAP = `
Memory Configuration

Name             Origin             Length             Attributes
RAM              0x20000000         0x00020000         xrw
FLASH            0x08000000         0x00100000         xr
*default*        0x00000000         0xffffffff

Linker script and memory map
`.trimStart();

suite('MapElfParser', () => {
  let parser: MapElfParser;

  setup(() => {
    parser = new MapElfParser('', false);
  });

  // Access private method for unit testing
  const isCatchAll = (p: MapElfParser, name: string): boolean =>
    (p as any).isCatchAllRegion(name);

  const parseMap = (p: MapElfParser, filePath: string): any[] =>
    (p as any).parseMap(filePath);

  suite('isCatchAllRegion', () => {
    test('*default* is a catch-all', () => {
      assert.ok(isCatchAll(parser, '*default*'));
    });

    test('*DEFAULT* is a catch-all (case-insensitive)', () => {
      assert.ok(isCatchAll(parser, '*DEFAULT*'));
    });

    test('*catch-all* is a catch-all', () => {
      assert.ok(isCatchAll(parser, '*catch-all*'));
    });

    test('*catchall* is a catch-all', () => {
      assert.ok(isCatchAll(parser, '*catchall*'));
    });

    test('any *...*-wrapped name is a catch-all', () => {
      assert.ok(isCatchAll(parser, '*something*'));
    });

    test('RAM is not a catch-all', () => {
      assert.ok(!isCatchAll(parser, 'RAM'));
    });

    test('FLASH is not a catch-all', () => {
      assert.ok(!isCatchAll(parser, 'FLASH'));
    });

    test('CCRAM is not a catch-all', () => {
      assert.ok(!isCatchAll(parser, 'CCRAM'));
    });
  });

  suite('parseMap', () => {
    let tempFile: string;

    setup(() => {
      tempFile = path.join(os.tmpdir(), `stm32-test-${Date.now()}.map`);
      fs.writeFileSync(tempFile, SAMPLE_MAP, 'utf8');
    });

    teardown(() => {
      try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
    });

    test('returns exactly 2 regions (RAM and FLASH)', () => {
      const regions = parseMap(parser, tempFile);
      assert.strictEqual(regions.length, 2);
    });

    test('RAM region has correct name', () => {
      const regions = parseMap(parser, tempFile);
      assert.ok(regions.some((r: any) => r.name === 'RAM'));
    });

    test('RAM region has correct startAddress', () => {
      const regions = parseMap(parser, tempFile);
      const ram = regions.find((r: any) => r.name === 'RAM');
      assert.strictEqual(ram.startAddress, 0x20000000);
    });

    test('RAM region has correct size', () => {
      const regions = parseMap(parser, tempFile);
      const ram = regions.find((r: any) => r.name === 'RAM');
      assert.strictEqual(ram.size, 0x00020000);
    });

    test('FLASH region has correct startAddress', () => {
      const regions = parseMap(parser, tempFile);
      const flash = regions.find((r: any) => r.name === 'FLASH');
      assert.strictEqual(flash.startAddress, 0x08000000);
    });

    test('FLASH region has correct size', () => {
      const regions = parseMap(parser, tempFile);
      const flash = regions.find((r: any) => r.name === 'FLASH');
      assert.strictEqual(flash.size, 0x00100000);
    });

    test('catch-all *default* region is excluded', () => {
      const regions = parseMap(parser, tempFile);
      assert.ok(!regions.some((r: any) => r.name === '*default*'));
    });

    test('all regions start with used=0 and empty sections', () => {
      const regions = parseMap(parser, tempFile);
      for (const r of regions) {
        assert.strictEqual(r.used, 0);
        assert.deepStrictEqual(r.sections, []);
      }
    });

    test('stops parsing after "Linker script and memory map"', () => {
      const extraContent = SAMPLE_MAP + '\nEXTRA            0x30000000         0x00010000\n';
      const extraFile = path.join(os.tmpdir(), `stm32-test-extra-${Date.now()}.map`);
      fs.writeFileSync(extraFile, extraContent, 'utf8');
      try {
        const regions = parseMap(parser, extraFile);
        assert.ok(!regions.some((r: any) => r.name === 'EXTRA'));
      } finally {
        try { fs.unlinkSync(extraFile); } catch { /* ignore */ }
      }
    });
  });

  // Regression guard for issue #11: the parser must analyze a throwaway copy
  // of the ELF, never the build's own output file, so it can't keep a handle
  // open that blocks the next build from deleting/overwriting it on Windows.
  suite('withElfCopy', () => {
    const withElfCopy = (p: MapElfParser, elf: string, fn: (elf: string) => void): void =>
      (p as any).withElfCopy(elf, fn);

    let elfFile: string;

    setup(() => {
      elfFile = path.join(os.tmpdir(), `stm32-test-${Date.now()}-${Math.random().toString(36).slice(2)}.elf`);
      fs.writeFileSync(elfFile, Buffer.from('ELF\0fake-binary-content'));
    });

    teardown(() => {
      try { fs.unlinkSync(elfFile); } catch { /* ignore */ }
    });

    test('passes a different path than the original ELF', () => {
      let seen: string | undefined;
      withElfCopy(parser, elfFile, p => { seen = p; });
      assert.notStrictEqual(seen, elfFile);
    });

    test('the copy exists during the callback', () => {
      let existedDuring = false;
      withElfCopy(parser, elfFile, p => { existedDuring = fs.existsSync(p); });
      assert.ok(existedDuring);
    });

    test('the copy has the same bytes as the original', () => {
      const original = fs.readFileSync(elfFile);
      let copyContent: Buffer | undefined;
      withElfCopy(parser, elfFile, p => { copyContent = fs.readFileSync(p); });
      assert.ok(copyContent && original.equals(copyContent));
    });

    test('removes the copy after the callback returns', () => {
      let copyPath: string | undefined;
      withElfCopy(parser, elfFile, p => { copyPath = p; });
      assert.ok(copyPath);
      assert.ok(!fs.existsSync(copyPath!));
    });

    test('leaves the original ELF untouched', () => {
      const before = fs.readFileSync(elfFile);
      withElfCopy(parser, elfFile, () => { /* noop */ });
      assert.ok(fs.existsSync(elfFile));
      assert.ok(before.equals(fs.readFileSync(elfFile)));
    });

    test('cleans up the copy even when the callback throws', () => {
      let copyPath: string | undefined;
      assert.throws(() => {
        withElfCopy(parser, elfFile, p => { copyPath = p; throw new Error('boom'); });
      }, /boom/);
      assert.ok(copyPath);
      assert.ok(!fs.existsSync(copyPath!));
    });

    test('falls back to the original path when the ELF cannot be copied', () => {
      const missing = path.join(os.tmpdir(), `stm32-missing-${Date.now()}.elf`);
      let seen: string | undefined;
      withElfCopy(parser, missing, p => { seen = p; });
      assert.strictEqual(seen, missing);
    });
  });
});
