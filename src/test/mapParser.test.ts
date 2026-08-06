import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MapElfParser, ToolExecutionError } from '../services/MapElfParser';

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

    test('rejects an empty MAP file with its path', () => {
      fs.writeFileSync(tempFile, ' \n', 'utf8');

      assert.throws(
        () => parseMap(parser, tempFile),
        error => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /MAP file is empty/);
          assert.ok(error.message.includes(tempFile));
          return true;
        }
      );
    });

    test('rejects a MAP file without a supported memory configuration', () => {
      fs.writeFileSync(tempFile, 'Linker script and memory map\n.text 0x08000000', 'utf8');

      assert.throws(
        () => parseMap(parser, tempFile),
        error => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /does not contain a supported GNU linker Memory Configuration/);
          assert.ok(error.message.includes(tempFile));
          return true;
        }
      );
    });

    test('reports unreadable or missing MAP files clearly', () => {
      const missing = `${tempFile}.missing`;

      assert.throws(
        () => parseMap(parser, missing),
        error => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /cannot read MAP file/);
          assert.ok(error.message.includes(missing));
          return true;
        }
      );
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

  suite('tool resolution', () => {
    let tempDir: string;

    setup(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stm32-tool-resolution-'));
    });

    teardown(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('uses a configured binary when it exists', () => {
      const executable = `arm-none-eabi-objdump${process.platform === 'win32' ? '.exe' : ''}`;
      const fullPath = path.join(tempDir, executable);
      fs.writeFileSync(fullPath, '');
      const configuredParser = new MapElfParser(tempDir, false);

      const resolved = (configuredParser as any).getTool('arm-none-eabi-objdump');

      assert.strictEqual(resolved, fullPath);
    });

    test('falls back to PATH when the configured binary is absent', () => {
      const configuredParser = new MapElfParser(tempDir, false);

      const resolved = (configuredParser as any).getTool('arm-none-eabi-objdump');

      assert.strictEqual(resolved, 'arm-none-eabi-objdump');
    });
  });

  suite('tool execution', () => {
    test('returns stdout after a successful execution', () => {
      const parserWithSuccessfulTool = new MapElfParser('', false, () => ({
        pid: 1,
        output: [],
        stdout: Buffer.from('tool output'),
        stderr: Buffer.alloc(0),
        status: 0,
        signal: null,
      } as any));

      const stdout = (parserWithSuccessfulTool as any)
        .runTool('arm-none-eabi-objdump', [], 1024);

      assert.strictEqual(stdout, 'tool output');
    });

    test('throws an actionable error when the tool cannot be spawned', () => {
      const parserWithMissingTool = new MapElfParser('', false, () => ({
        pid: 0,
        output: [],
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        status: null,
        signal: null,
        error: new Error('spawn ENOENT'),
      } as any));

      assert.throws(
        () => (parserWithMissingTool as any)
          .runTool('arm-none-eabi-objdump', [], 1024),
        (err: unknown) => {
          assert.ok(err instanceof ToolExecutionError);
          assert.strictEqual(err.tool, 'arm-none-eabi-objdump');
          assert.match(err.message, /spawn ENOENT/);
          assert.match(err.message, /configure stm32BuildAnalyzerEnhanced\.toolchainPath/i);
          return true;
        }
      );
    });

    test('includes exit status and stderr in non-zero-exit errors', () => {
      const parserWithFailingTool = new MapElfParser('', false, () => ({
        pid: 1,
        output: [],
        stdout: Buffer.alloc(0),
        stderr: Buffer.from('not an ELF file'),
        status: 1,
        signal: null,
      } as any));

      assert.throws(
        () => (parserWithFailingTool as any)
          .runTool('arm-none-eabi-objdump', [], 1024),
        (err: unknown) => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /exited with code 1/);
          assert.match(err.message, /not an ELF file/);
          return true;
        }
      );
    });

    test('rejects successful objdump output that cannot populate any region', () => {
      const parserWithUnmatchedOutput = new MapElfParser('', false, () => ({
        pid: 1,
        output: [],
        stdout: Buffer.from('Sections:\\nIdx Name Size VMA LMA'),
        stderr: Buffer.alloc(0),
        status: 0,
        signal: null,
      } as any));
      const regions = [{
        name: 'FLASH',
        startAddress: 0x08000000,
        size: 0x10000,
        used: 0,
        sections: [],
      }];

      assert.throws(
        () => (parserWithUnmatchedOutput as any).parseSections('firmware.elf', regions),
        /no allocatable ELF sections matched/
      );
    });

    test('counts initialized RAM sections in both runtime and load regions', () => {
      const output = [
        'Sections:',
        'Idx Name          Size      VMA       LMA       File off  Algn',
        '  0 .ramfunc      00000020  20000000  08000100  00000100  2**2',
        '                  CONTENTS, ALLOC, LOAD, READONLY, CODE',
        '  1 .data.extra   00000010  20000020  08000120  00000120  2**2',
        '                  CONTENTS, ALLOC, LOAD, DATA',
      ].join('\n');
      const parserWithSections = new MapElfParser('', false, () => ({
        pid: 1,
        output: [],
        stdout: Buffer.from(output),
        stderr: Buffer.alloc(0),
        status: 0,
        signal: null,
      } as any));
      const regions = [
        {
          name: 'FLASH',
          startAddress: 0x08000000,
          size: 0x10000,
          used: 0,
          sections: [],
        },
        {
          name: 'RAM',
          startAddress: 0x20000000,
          size: 0x10000,
          used: 0,
          sections: [],
        },
      ];

      (parserWithSections as any).parseSections('firmware.elf', regions);

      assert.strictEqual(regions[0].used, 0x30);
      assert.strictEqual(regions[1].used, 0x30);
      assert.deepStrictEqual(
        regions[0].sections.map((section: any) => [section.name, section.startAddress]),
        [
          ['.ramfunc', 0x08000100],
          ['.data.extra', 0x08000120],
        ]
      );
      assert.deepStrictEqual(
        regions[1].sections.map((section: any) => [section.name, section.startAddress]),
        [
          ['.ramfunc', 0x20000000],
          ['.data.extra', 0x20000020],
        ]
      );
    });

    test('does not count BSS or NOLOAD-style sections in Flash', () => {
      const output = [
        'Sections:',
        'Idx Name          Size      VMA       LMA       File off  Algn',
        '  0 .bss          00000040  20000000  20000000  00000100  2**2',
        '                  ALLOC',
        '  1 .noinit       00000020  20000040  08000200  00000140  2**2',
        '                  ALLOC',
      ].join('\n');
      const parserWithSections = new MapElfParser('', false, () => ({
        pid: 1,
        output: [],
        stdout: Buffer.from(output),
        stderr: Buffer.alloc(0),
        status: 0,
        signal: null,
      } as any));
      const regions = [
        {
          name: 'FLASH',
          startAddress: 0x08000000,
          size: 0x10000,
          used: 0,
          sections: [],
        },
        {
          name: 'RAM',
          startAddress: 0x20000000,
          size: 0x10000,
          used: 0,
          sections: [],
        },
      ];

      (parserWithSections as any).parseSections('firmware.elf', regions);

      assert.strictEqual(regions[0].used, 0);
      assert.strictEqual(regions[1].used, 0x60);
      assert.deepStrictEqual(
        regions[1].sections.map((section: any) => section.name),
        ['.bss', '.noinit']
      );
    });
  });
});
