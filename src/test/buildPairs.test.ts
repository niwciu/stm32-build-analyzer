import * as assert from 'assert';
import {
  findPreferredBuildOutput,
  pairBuildOutputNames,
} from '../utils/buildPairs';

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

  test('keeps a previously selected build output when it still exists', () => {
    const candidates = [
      { map: '/workspace/a.map', elf: '/workspace/a.elf', label: 'a' },
      { map: '/workspace/b.map', elf: '/workspace/b.elf', label: 'b' },
    ];

    assert.strictEqual(
      findPreferredBuildOutput(candidates, {
        map: '/workspace/b.map',
        elf: '/workspace/b.elf',
      }),
      candidates[1]
    );
  });

  test('matches a previous Windows selection case-insensitively', () => {
    const candidate = {
      map: 'D:\\Build\\Firmware.MAP',
      elf: 'D:\\Build\\Firmware.ELF',
    };

    assert.strictEqual(
      findPreferredBuildOutput(
        [candidate],
        {
          map: 'd:\\build\\firmware.map',
          elf: 'd:\\build\\firmware.elf',
        },
        'win32'
      ),
      candidate
    );
  });

  test('does not reuse a build output that is no longer available', () => {
    assert.strictEqual(
      findPreferredBuildOutput(
        [{ map: '/workspace/a.map', elf: '/workspace/a.elf' }],
        { map: '/workspace/missing.map', elf: '/workspace/missing.elf' }
      ),
      undefined
    );
  });
});
