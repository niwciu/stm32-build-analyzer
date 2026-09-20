import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import {
  GnuBinutilsParser,
  GnuRegion,
} from '../toolchains/gnu/GnuBinutilsParser';

suite('GnuBinutilsParser', () => {
  const parser = new GnuBinutilsParser();

  test('rejects objdump output that cannot populate any region', () => {
    const regions = flashAndRam();

    assert.throws(
      () => parser.parseSections('Sections:\nIdx Name Size VMA LMA', regions),
      /no allocatable ELF sections matched/
    );
  });

  test('counts initialized RAM sections in runtime and load regions', () => {
    const output = [
      'Sections:',
      'Idx Name          Size      VMA       LMA       File off  Algn',
      '  0 .ramfunc      00000020  20000000  08000100  00000100  2**2',
      '                  CONTENTS, ALLOC, LOAD, READONLY, CODE',
      '  1 .data.extra   00000010  20000020  08000120  00000120  2**2',
      '                  CONTENTS, ALLOC, LOAD, DATA',
    ].join('\n');
    const regions = flashAndRam();

    parser.parseSections(output, regions);

    assert.strictEqual(regions[0].used, 0x30);
    assert.strictEqual(regions[1].used, 0x30);
    assert.deepStrictEqual(
      regions[0].sections.map(section => [section.name, section.startAddress]),
      [['.ramfunc', 0x08000100], ['.data.extra', 0x08000120]]
    );
    assert.deepStrictEqual(
      regions[1].sections.map(section => [section.name, section.startAddress]),
      [['.ramfunc', 0x20000000], ['.data.extra', 0x20000020]]
    );
  });

  test('parses objdump sections with CRLF line endings', () => {
    const output = [
      'Sections:',
      'Idx Name          Size      VMA       LMA       File off  Algn',
      '  0 .text         00000020  08000000  08000000  00000100  2**2',
      '                  CONTENTS, ALLOC, LOAD, READONLY, CODE',
      '',
    ].join('\r\n');
    const regions = flashAndRam();

    parser.parseSections(output, regions);

    assert.strictEqual(regions[0].used, 0x20);
    assert.deepStrictEqual(regions[0].sections.map(section => section.name), ['.text']);
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
    const regions = flashAndRam();

    parser.parseSections(output, regions);

    assert.strictEqual(regions[0].used, 0);
    assert.strictEqual(regions[1].used, 0x60);
    assert.deepStrictEqual(
      regions[1].sections.map(section => section.name),
      ['.bss', '.noinit']
    );
  });

  test('preserves demangled names, nullable sizes, and paths containing spaces', () => {
    const output = [
      '08000000 00000010 T Namespace::Widget::operator new(unsigned long)\tsrc/generated files/widget.cpp:27',
      '08000010 T symbol_without_size',
    ].join('\n');
    const regions = withTextSection();
    const sourceBase = path.join(os.tmpdir(), 'firmware build');

    parser.parseSymbols(output, regions, sourceBase);

    const symbols = regions[0].sections[0].symbols;
    assert.strictEqual(symbols[0].name, 'Namespace::Widget::operator new(unsigned long)');
    assert.strictEqual(
      symbols[0].source?.path,
      path.resolve(sourceBase, 'src/generated files/widget.cpp')
    );
    assert.strictEqual(symbols[0].source?.line, 27);
    assert.strictEqual(symbols[1].name, 'symbol_without_size');
    assert.strictEqual(symbols[1].size, null);
    assert.strictEqual(symbols[1].source, undefined);
  });

  test('parses nm symbols and locations with CRLF line endings', () => {
    const output = [
      '08000000 00000010 T merge_task\tsrc/merge.c:747',
      '08000010 00000008 T state_counter\tsrc/state.c:12',
      '',
    ].join('\r\n');
    const regions = withTextSection();
    const sourceBase = path.join(os.tmpdir(), 'firmware-build');

    parser.parseSymbols(output, regions, sourceBase);

    assert.deepStrictEqual(
      regions[0].sections[0].symbols.map(symbol => ({
        name: symbol.name,
        path: symbol.source?.path,
        line: symbol.source?.line,
      })),
      [
        {
          name: 'merge_task',
          path: path.resolve(sourceBase, 'src/merge.c'),
          line: 747,
        },
        {
          name: 'state_counter',
          path: path.resolve(sourceBase, 'src/state.c'),
          line: 12,
        },
      ]
    );
  });

  test('keeps absolute source paths unchanged', () => {
    const absoluteSource = path.join(os.tmpdir(), 'source folder', 'main.cpp');
    const regions = withTextSection();

    parser.parseSymbols(
      `08000000 00000010 T main\t${absoluteSource}:12`,
      regions,
      '/another/base'
    );

    assert.strictEqual(
      regions[0].sections[0].symbols[0].source?.path,
      path.normalize(absoluteSource)
    );
  });
});

function flashAndRam(): GnuRegion[] {
  return [
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
}

function withTextSection(): GnuRegion[] {
  return [{
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
}
