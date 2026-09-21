import * as assert from 'assert';
import * as path from 'path';
import { discoverGnuToolPrefix } from '../toolchains/gnu/GnuToolPrefixDiscovery';

const PREFIXES = [
  'riscv64-unknown-elf-',
  'riscv32-unknown-elf-',
  'riscv-none-elf-',
] as const;

suite('GNU tool-prefix discovery', () => {
  test('prefers a configured-directory variant over PATH', () => {
    const configuredTool = path.posix.join(
      '/configured/bin',
      'riscv32-unknown-elf-objdump'
    );
    const pathTool = path.posix.join(
      '/path/bin',
      'riscv64-unknown-elf-objdump'
    );

    assert.strictEqual(discoverGnuToolPrefix(PREFIXES, '/configured/bin', {
      pathValue: '/path/bin',
      platform: 'linux',
      isExecutableFile: candidate => [configuredTool, pathTool].includes(candidate),
    }), 'riscv32-unknown-elf-');
  });

  test('searches PATH entries before later directories', () => {
    const firstDirectoryTool = path.posix.join(
      '/first',
      'riscv-none-elf-objdump'
    );
    const secondDirectoryTool = path.posix.join(
      '/second',
      'riscv64-unknown-elf-objdump'
    );

    assert.strictEqual(discoverGnuToolPrefix(PREFIXES, '', {
      pathValue: '/first:/second',
      platform: 'linux',
      isExecutableFile: candidate =>
        [firstDirectoryTool, secondDirectoryTool].includes(candidate),
    }), 'riscv-none-elf-');
  });

  test('handles quoted Windows PATH entries and executable suffixes', () => {
    const executable = path.win32.join(
      'C:\\RISC-V Tools\\bin',
      'riscv64-unknown-elf-objdump.exe'
    );

    assert.strictEqual(discoverGnuToolPrefix(PREFIXES, '', {
      pathValue: '"C:\\RISC-V Tools\\bin";C:\\Other',
      platform: 'win32',
      isExecutableFile: candidate => candidate === executable,
    }), 'riscv64-unknown-elf-');
  });

  test('uses the first prefix as a deterministic fallback', () => {
    assert.strictEqual(discoverGnuToolPrefix(PREFIXES, '', {
      pathValue: '',
      platform: 'linux',
      isExecutableFile: () => false,
    }), 'riscv64-unknown-elf-');
  });

  test('rejects an empty candidate list', () => {
    assert.throws(
      () => discoverGnuToolPrefix([], '', { pathValue: '' }),
      /At least one GNU tool prefix/
    );
  });
});
