import * as fs from 'fs';
import * as path from 'path';
import Mocha = require('mocha');

async function findTestFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
  });
  const testRoot = path.resolve(__dirname, '..');
  const files = await findTestFiles(testRoot);
  files.forEach(file => mocha.addFile(file));

  await new Promise<void>((resolve, reject) => {
    mocha.run(failures => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
