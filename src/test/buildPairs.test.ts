import * as assert from 'assert';
import { pairBuildOutputNames } from '../utils/buildPairs';

suite('build output pairing', () => {
  test('pairs MAP and ELF files with the same basename', () => {
    assert.deepStrictEqual(
      pairBuildOutputNames(['firmware.map', 'firmware.elf']),
      [{ map: 'firmware.map', elf: 'firmware.elf', stem: 'firmware' }]
    );
  });

  test('does not pair unrelated targets', () => {
    assert.deepStrictEqual(
      pairBuildOutputNames(['application.map', 'bootloader.elf']),
      []
    );
  });

  test('returns each matching pair instead of selecting files independently', () => {
    assert.deepStrictEqual(
      pairBuildOutputNames([
        'bootloader.elf',
        'application.map',
        'bootloader.map',
        'application.elf',
      ]),
      [
        { map: 'application.map', elf: 'application.elf', stem: 'application' },
        { map: 'bootloader.map', elf: 'bootloader.elf', stem: 'bootloader' },
      ]
    );
  });

  test('matches extensions and basenames case-insensitively', () => {
    assert.deepStrictEqual(
      pairBuildOutputNames(['Firmware.MAP', 'firmware.ELF']),
      [{ map: 'Firmware.MAP', elf: 'firmware.ELF', stem: 'Firmware' }]
    );
  });

  test('orders release and debug pairs deterministically', () => {
    assert.deepStrictEqual(
      pairBuildOutputNames([
        'zeta.map',
        'zeta.elf',
        'app-debug.map',
        'app-debug.elf',
        'app-release.map',
        'app-release.elf',
      ]).map(pair => pair.stem),
      ['app-release', 'app-debug', 'zeta']
    );
  });
});
