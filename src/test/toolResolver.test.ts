import * as assert from 'assert';
import * as path from 'path';
import {
  ConfiguredDirectoryToolResolver,
  getToolFilename,
} from '../process/ToolResolver';

suite('ToolResolver', () => {
  test('adds the executable suffix only on Windows', () => {
    assert.strictEqual(getToolFilename('arm-none-eabi-nm', 'win32'), 'arm-none-eabi-nm.exe');
    assert.strictEqual(getToolFilename('arm-none-eabi-nm', 'linux'), 'arm-none-eabi-nm');
  });

  test('uses an existing tool from the configured directory', () => {
    const directory = path.join('workspace', 'toolchain', 'bin');
    const candidate = path.join(directory, 'arm-none-eabi-objdump');
    const resolver = new ConfiguredDirectoryToolResolver(
      directory,
      'linux',
      value => value === candidate
    );

    assert.deepStrictEqual(resolver.resolve('arm-none-eabi-objdump'), {
      command: candidate,
      source: 'configured-directory',
      configuredCandidate: candidate,
    });
  });

  test('checks the Windows executable name in a configured directory', () => {
    const directory = path.join('C:', 'toolchain', 'bin');
    const candidate = path.join(directory, 'arm-none-eabi-nm.exe');
    const resolver = new ConfiguredDirectoryToolResolver(
      directory,
      'win32',
      value => value === candidate
    );

    assert.strictEqual(resolver.resolve('arm-none-eabi-nm').command, candidate);
  });

  test('falls back to PATH when the configured binary is absent', () => {
    const resolver = new ConfiguredDirectoryToolResolver(
      '/missing/toolchain',
      'linux',
      () => false
    );

    assert.deepStrictEqual(resolver.resolve('arm-none-eabi-objdump'), {
      command: 'arm-none-eabi-objdump',
      source: 'path',
      configuredCandidate: path.join('/missing/toolchain', 'arm-none-eabi-objdump'),
    });
  });

  test('uses PATH directly when no directory is configured', () => {
    const resolver = new ConfiguredDirectoryToolResolver('', 'linux', () => true);

    assert.deepStrictEqual(resolver.resolve('arm-none-eabi-nm'), {
      command: 'arm-none-eabi-nm',
      source: 'path',
    });
  });
});
