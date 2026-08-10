import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite');
  const fixtureRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'stm32-build-analyzer-tests-')
  );
  const applicationRoot = path.join(fixtureRoot, 'application');
  const toolchainRoot = path.join(fixtureRoot, 'toolchain');
  const workspaceFile = path.join(fixtureRoot, 'fixture.code-workspace');

  try {
    await Promise.all([
      fs.promises.mkdir(applicationRoot, { recursive: true }),
      fs.promises.mkdir(toolchainRoot, { recursive: true }),
    ]);
    await fs.promises.writeFile(
      workspaceFile,
      JSON.stringify({
        folders: [
          { name: 'Application', path: applicationRoot },
          { name: 'Toolchain', path: toolchainRoot },
        ],
      }),
      'utf8'
    );

    delete process.env.ELECTRON_RUN_AS_NODE;
    delete process.env.ELECTRON_NO_ATTACH_CONSOLE;
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspaceFile,
        '--disable-extensions',
        '--disable-workspace-trust',
      ],
    });
  } catch (error) {
    console.error('Failed to run VS Code extension tests:', error);
    process.exitCode = 1;
  } finally {
    await fs.promises.rm(fixtureRoot, { recursive: true, force: true });
  }
}

void main();
