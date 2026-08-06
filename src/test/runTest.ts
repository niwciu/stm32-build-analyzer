import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite');

  try {
    delete process.env.ELECTRON_RUN_AS_NODE;
    delete process.env.ELECTRON_NO_ATTACH_CONSOLE;
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        extensionDevelopmentPath,
        '--disable-extensions',
      ],
    });
  } catch (error) {
    console.error('Failed to run VS Code extension tests:', error);
    process.exitCode = 1;
  }
}

void main();
