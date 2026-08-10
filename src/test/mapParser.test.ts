import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MapElfParser,
  spawnTool,
  ToolExecutionError,
} from '../services/MapElfParser';
import { AnalysisCancelledError } from '../utils/errors';

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
    const withElfCopy = (
      p: MapElfParser,
      elf: string,
      fn: (elf: string) => Promise<void>
    ): Promise<void> =>
      (p as any).withElfCopy(elf, fn);

    let elfFile: string;

    setup(() => {
      elfFile = path.join(os.tmpdir(), `stm32-test-${Date.now()}-${Math.random().toString(36).slice(2)}.elf`);
      fs.writeFileSync(elfFile, Buffer.from('ELF\0fake-binary-content'));
    });

    teardown(() => {
      try { fs.unlinkSync(elfFile); } catch { /* ignore */ }
    });

    test('passes a different path than the original ELF', async () => {
      let seen: string | undefined;
      await withElfCopy(parser, elfFile, async p => { seen = p; });
      assert.notStrictEqual(seen, elfFile);
    });

    test('the copy exists during the callback', async () => {
      let existedDuring = false;
      await withElfCopy(parser, elfFile, async p => { existedDuring = fs.existsSync(p); });
      assert.ok(existedDuring);
    });

    test('the copy has the same bytes as the original', async () => {
      const original = fs.readFileSync(elfFile);
      let copyContent: Buffer | undefined;
      await withElfCopy(parser, elfFile, async p => { copyContent = fs.readFileSync(p); });
      assert.ok(copyContent && original.equals(copyContent));
    });

    test('removes the copy after the callback returns', async () => {
      let copyPath: string | undefined;
      await withElfCopy(parser, elfFile, async p => { copyPath = p; });
      assert.ok(copyPath);
      assert.ok(!fs.existsSync(copyPath!));
    });

    test('leaves the original ELF untouched', async () => {
      const before = fs.readFileSync(elfFile);
      await withElfCopy(parser, elfFile, async () => { /* noop */ });
      assert.ok(fs.existsSync(elfFile));
      assert.ok(before.equals(fs.readFileSync(elfFile)));
    });

    test('cleans up the copy even when the callback throws', async () => {
      let copyPath: string | undefined;
      await assert.rejects(
        withElfCopy(parser, elfFile, async p => {
          copyPath = p;
          throw new Error('boom');
        }),
        /boom/
      );
      assert.ok(copyPath);
      assert.ok(!fs.existsSync(copyPath!));
    });

    test('falls back to the original path when the ELF cannot be copied', async () => {
      const missing = path.join(os.tmpdir(), `stm32-missing-${Date.now()}.elf`);
      let seen: string | undefined;
      await withElfCopy(parser, missing, async p => { seen = p; });
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
    test('terminates a tool that exceeds its timeout', async () => {
      const result = await spawnTool(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 1000)'],
        { maxBuffer: 1024, timeoutMs: 20 }
      );

      assert.match(result.error?.message ?? '', /timed out after 20 ms/);
    });

    test('terminates a tool that exceeds the output limit', async function () {
      if (process.platform === 'win32') {
        this.skip();
      }
      const result = await spawnTool(
        '/usr/bin/printf',
        ['x'.repeat(2048)],
        { maxBuffer: 128, timeoutMs: 1000 }
      );

      assert.match(result.error?.message ?? '', /stdout exceeded 128 bytes/);
    });

    test('terminates a tool when a newer refresh cancels it', async () => {
      const controller = new AbortController();
      const resultPromise = spawnTool(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 1000)'],
        {
          maxBuffer: 1024,
          timeoutMs: 1000,
          signal: controller.signal,
        }
      );
      setTimeout(() => controller.abort(), 20);

      const result = await resultPromise;

      assert.ok(result.error instanceof AnalysisCancelledError);
    });

    test('returns stdout after a successful execution', async () => {
      const parserWithSuccessfulTool = new MapElfParser('', false, async () => ({
        pid: 1,
        output: [],
        stdout: Buffer.from('tool output'),
        stderr: Buffer.alloc(0),
        status: 0,
        signal: null,
      } as any));

      const stdout = await (parserWithSuccessfulTool as any)
        .runTool('arm-none-eabi-objdump', [], 1024);

      assert.strictEqual(stdout, 'tool output');
    });

    test('throws an actionable error when the tool cannot be spawned', async () => {
      const parserWithMissingTool = new MapElfParser('', false, async () => ({
        pid: 0,
        output: [],
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        status: null,
        signal: null,
        error: new Error('spawn ENOENT'),
      } as any));

      await assert.rejects(
        (parserWithMissingTool as any)
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

    test('includes exit status and stderr in non-zero-exit errors', async () => {
      const parserWithFailingTool = new MapElfParser('', false, async () => ({
        pid: 1,
        output: [],
        stdout: Buffer.alloc(0),
        stderr: Buffer.from('not an ELF file'),
        status: 1,
        signal: null,
      } as any));

      await assert.rejects(
        (parserWithFailingTool as any)
          .runTool('arm-none-eabi-objdump', [], 1024),
        (err: unknown) => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /exited with code 1/);
          assert.match(err.message, /not an ELF file/);
          return true;
        }
      );
    });

    test('rejects successful objdump output that cannot populate any region', async () => {
      const parserWithUnmatchedOutput = new MapElfParser('', false, async () => ({
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

      await assert.rejects(
        (parserWithUnmatchedOutput as any).parseSections('firmware.elf', regions),
        /no allocatable ELF sections matched/
      );
    });

    test('counts initialized RAM sections in both runtime and load regions', async () => {
      const output = [
        'Sections:',
        'Idx Name          Size      VMA       LMA       File off  Algn',
        '  0 .ramfunc      00000020  20000000  08000100  00000100  2**2',
        '                  CONTENTS, ALLOC, LOAD, READONLY, CODE',
        '  1 .data.extra   00000010  20000020  08000120  00000120  2**2',
        '                  CONTENTS, ALLOC, LOAD, DATA',
      ].join('\n');
      const parserWithSections = new MapElfParser('', false, async () => ({
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

      await (parserWithSections as any).parseSections('firmware.elf', regions);

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

    test('does not count BSS or NOLOAD-style sections in Flash', async () => {
      const output = [
        'Sections:',
        'Idx Name          Size      VMA       LMA       File off  Algn',
        '  0 .bss          00000040  20000000  20000000  00000100  2**2',
        '                  ALLOC',
        '  1 .noinit       00000020  20000040  08000200  00000140  2**2',
        '                  ALLOC',
      ].join('\n');
      const parserWithSections = new MapElfParser('', false, async () => ({
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

      await (parserWithSections as any).parseSections('firmware.elf', regions);

      assert.strictEqual(regions[0].used, 0);
      assert.strictEqual(regions[1].used, 0x60);
      assert.deepStrictEqual(
        regions[1].sections.map((section: any) => section.name),
        ['.bss', '.noinit']
      );
    });

    test('preserves memory usage and warns when nm fails', async () => {
      const tempMap = path.join(os.tmpdir(), `stm32-partial-${Date.now()}.map`);
      const tempElf = path.join(os.tmpdir(), `stm32-partial-${Date.now()}.elf`);
      fs.writeFileSync(tempMap, SAMPLE_MAP, 'utf8');
      fs.writeFileSync(tempElf, 'fake elf', 'utf8');
      let call = 0;
      const parserWithFailingNm = new MapElfParser('', false, async () => {
        call++;
        if (call === 1) {
          return {
            pid: 1,
            output: [],
            stdout: Buffer.from([
              'Sections:',
              'Idx Name          Size      VMA       LMA       File off  Algn',
              '  0 .text         00000020  08000000  08000000  00000100  2**2',
              '                  CONTENTS, ALLOC, LOAD, READONLY, CODE',
            ].join('\n')),
            stderr: Buffer.alloc(0),
            status: 0,
            signal: null,
          } as any;
        }
        return {
          pid: 1,
          output: [],
          stdout: Buffer.alloc(0),
          stderr: Buffer.from('symbol table unavailable'),
          status: 1,
          signal: null,
        } as any;
      });

      try {
        const regions = await parserWithFailingNm.parse(tempMap, tempElf);
        const flash = regions.find(region => region.name === 'FLASH');

        assert.strictEqual(flash?.used, 0x20);
        assert.strictEqual(parserWithFailingNm.warnings.length, 1);
        assert.match(parserWithFailingNm.warnings[0], /failed to run arm-none-eabi-nm/);
        assert.match(parserWithFailingNm.warnings[0], /symbol and source details are incomplete/);
      } finally {
        fs.rmSync(tempMap, { force: true });
        fs.rmSync(tempElf, { force: true });
      }
    });

    test('preserves demangled names and source paths containing spaces', async () => {
      const output = [
        '08000000 00000010 T Namespace::Widget::operator new(unsigned long)\tsrc/generated files/widget.cpp:27',
        '08000010 00000008 T symbol_without_source',
      ].join('\n');
      const parserWithSymbols = new MapElfParser('', false, async () => ({
        pid: 1,
        output: [],
        stdout: Buffer.from(output),
        stderr: Buffer.alloc(0),
        status: 0,
        signal: null,
      } as any));
      const regions = [{
        name: 'FLASH',
        startAddress: 0x08000000,
        size: 0x10000,
        used: 0x20,
        sections: [{
          name: '.text',
          startAddress: 0x08000000,
          loadAddress: 0x08000000,
          size: 0x20,
          symbols: [],
        }],
      }];
      const sourceBase = path.join(os.tmpdir(), 'firmware build');

      await (parserWithSymbols as any).parseSymbols('firmware.elf', regions, sourceBase);

      const symbols = regions[0].sections[0].symbols as any[];
      assert.strictEqual(
        symbols[0].name,
        'Namespace::Widget::operator new(unsigned long)'
      );
      assert.strictEqual(
        symbols[0].path,
        path.resolve(sourceBase, 'src/generated files/widget.cpp')
      );
      assert.strictEqual(symbols[0].row, 27);
      assert.strictEqual(symbols[1].name, 'symbol_without_source');
      assert.strictEqual(symbols[1].path, '');
    });

    test('keeps absolute source paths unchanged', async () => {
      const absoluteSource = path.join(os.tmpdir(), 'source folder', 'main.cpp');
      const output =
        `08000000 00000010 T main\t${absoluteSource}:12`;
      const parserWithSymbols = new MapElfParser('', false, async () => ({
        pid: 1,
        output: [],
        stdout: Buffer.from(output),
        stderr: Buffer.alloc(0),
        status: 0,
        signal: null,
      } as any));
      const regions = [{
        name: 'FLASH',
        startAddress: 0x08000000,
        size: 0x10000,
        used: 0x10,
        sections: [{
          name: '.text',
          startAddress: 0x08000000,
          loadAddress: 0x08000000,
          size: 0x10,
          symbols: [],
        }],
      }];

      await (parserWithSymbols as any).parseSymbols('firmware.elf', regions, '/another/base');

      const symbol = regions[0].sections[0].symbols[0] as any;
      assert.strictEqual(symbol.path, path.normalize(absoluteSource));
      assert.strictEqual(symbol.row, 12);
    });
  });
});
