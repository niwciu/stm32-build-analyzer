import * as assert from 'assert';
import * as os from 'os';
import { resolveVariables } from '../utils/pathVariables';

suite('resolveVariables', () => {

  suite('${userHome}', () => {
    test('expands to os.homedir()', () => {
      assert.strictEqual(
        resolveVariables('${userHome}/toolchain/bin'),
        `${os.homedir()}/toolchain/bin`
      );
    });

    test('expands multiple occurrences', () => {
      assert.strictEqual(
        resolveVariables('${userHome}/a:${userHome}/b'),
        `${os.homedir()}/a:${os.homedir()}/b`
      );
    });
  });

  suite('${env:VAR}', () => {
    test('expands a set environment variable', () => {
      process.env._STM32_TEST_VAR = '/opt/arm/bin';
      assert.strictEqual(
        resolveVariables('${env:_STM32_TEST_VAR}/nm'),
        '/opt/arm/bin/nm'
      );
      delete process.env._STM32_TEST_VAR;
    });

    test('expands to empty string for an unset variable', () => {
      delete process.env._STM32_UNSET_VAR;
      assert.strictEqual(
        resolveVariables('${env:_STM32_UNSET_VAR}/bin'),
        '/bin'
      );
    });

    test('expands multiple different env vars', () => {
      process.env._STM32_A = 'foo';
      process.env._STM32_B = 'bar';
      assert.strictEqual(
        resolveVariables('${env:_STM32_A}/${env:_STM32_B}'),
        'foo/bar'
      );
      delete process.env._STM32_A;
      delete process.env._STM32_B;
    });
  });

  suite('${workspaceFolder}', () => {
    test('expands when workspaceRoot is provided', () => {
      assert.strictEqual(
        resolveVariables('${workspaceFolder}/build', '/home/user/project'),
        '/home/user/project/build'
      );
    });

    test('is left unchanged when no workspaceRoot provided', () => {
      assert.strictEqual(
        resolveVariables('${workspaceFolder}/build'),
        '${workspaceFolder}/build'
      );
    });
  });

  suite('backward compatibility', () => {
    test('plain absolute path is returned unchanged', () => {
      const input = '/usr/local/arm-none-eabi/bin';
      assert.strictEqual(resolveVariables(input), input);
    });

    test('plain relative path is returned unchanged', () => {
      const input = './toolchain/bin';
      assert.strictEqual(resolveVariables(input), input);
    });

    test('Windows-style absolute path is returned unchanged', () => {
      const input = 'C:\\Users\\Username\\toolchain\\bin';
      assert.strictEqual(resolveVariables(input), input);
    });

    test('unknown ${token} is left unchanged', () => {
      const input = '${someUnknownToken}/bin';
      assert.strictEqual(resolveVariables(input), input);
    });

    test('empty string is returned unchanged', () => {
      assert.strictEqual(resolveVariables(''), '');
    });
  });

  suite('mixed tokens', () => {
    test('${userHome} and ${env:VAR} together', () => {
      process.env._STM32_ARCH = 'arm';
      const result = resolveVariables('${userHome}/${env:_STM32_ARCH}/bin');
      assert.strictEqual(result, `${os.homedir()}/arm/bin`);
      delete process.env._STM32_ARCH;
    });

    test('all three tokens in one string', () => {
      process.env._STM32_SUFFIX = 'release';
      const result = resolveVariables(
        '${userHome}:${env:_STM32_SUFFIX}:${workspaceFolder}',
        '/ws'
      );
      assert.strictEqual(result, `${os.homedir()}:release:/ws`);
      delete process.env._STM32_SUFFIX;
    });
  });
});
