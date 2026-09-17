import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import {
  GnuLinkerMapParser,
  isGnuCatchAllRegion,
} from '../toolchains/gnu-arm/GnuLinkerMapParser';

const SAMPLE_MAP = `
Memory Configuration

Name             Origin             Length             Attributes
RAM              0x20000000         0x00020000         xrw
FLASH            0x08000000         0x00100000         xr
*default*        0x00000000         0xffffffff

Linker script and memory map
`.trimStart();

suite('GnuLinkerMapParser', () => {
  const parser = new GnuLinkerMapParser();

  for (const name of ['*default*', '*DEFAULT*', '*catch-all*', '*catchall*', '*other*']) {
    test(`treats ${name} as a catch-all region`, () => {
      assert.ok(isGnuCatchAllRegion(name));
    });
  }

  for (const name of ['RAM', 'FLASH', 'CCRAM']) {
    test(`retains ${name} as a usable region`, () => {
      assert.ok(!isGnuCatchAllRegion(name));
    });
  }

  test('parses region addresses and sizes while excluding catch-all entries', () => {
    const regions = parser.parse(SAMPLE_MAP, 'firmware.map');

    assert.deepStrictEqual(regions, [
      {
        name: 'RAM',
        startAddress: 0x20000000,
        size: 0x20000,
        used: 0,
        sections: [],
      },
      {
        name: 'FLASH',
        startAddress: 0x08000000,
        size: 0x100000,
        used: 0,
        sections: [],
      },
    ]);
  });

  test('stops parsing after the linker memory-map header', () => {
    const content = SAMPLE_MAP + '\nEXTRA 0x30000000 0x10000\n';

    assert.ok(!parser.parse(content, 'firmware.map').some(region =>
      region.name === 'EXTRA'
    ));
  });

  test('rejects empty MAP content with its path', () => {
    assert.throws(
      () => parser.parse(' \n', '/build/empty.map'),
      error => error instanceof Error
        && /MAP file is empty/.test(error.message)
        && error.message.includes('/build/empty.map')
    );
  });

  test('rejects content without a supported memory configuration', () => {
    assert.throws(
      () => parser.parse('Linker script and memory map\n.text 0x08000000', 'bad.map'),
      /does not contain a supported GNU linker Memory Configuration/
    );
  });

  test('reports unreadable files with their paths', () => {
    const missing = path.join(os.tmpdir(), `missing-${Date.now()}.map`);

    assert.throws(
      () => parser.parseFile(missing),
      error => error instanceof Error
        && /cannot read MAP file/.test(error.message)
        && error.message.includes(missing)
    );
  });

  test('rejects address ranges beyond safe integer precision', () => {
    const content = [
      'Memory Configuration',
      'HUGE 0x20000000000000 0x10',
      'Linker script and memory map',
    ].join('\n');

    assert.throws(
      () => parser.parse(content, 'huge.map'),
      /safe integer precision|invalid region/
    );
  });
});
