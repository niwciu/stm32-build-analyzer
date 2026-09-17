import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ToolResolver } from '../process/ToolResolver';
import type { ToolRunner, ToolRunResult } from '../process/ToolRunner';
import {
  MapElfParser,
  ToolExecutionError,
} from '../services/MapElfParser';
import { loadToolchainFixtures } from './fixtures/fixtureLoader';

const fixture = loadToolchainFixtures().find(candidate =>
  candidate.manifest.id === 'gnu-arm-synthetic-minimal'
);
if (!fixture) {
  throw new Error('Missing gnu-arm-synthetic-minimal fixture');
}
const objdumpOutput = fs.readFileSync(fixture.inputPaths.objdumpStdout, 'utf8');
const nmOutput = fs.readFileSync(fixture.inputPaths.nmStdout, 'utf8');

suite('MapElfParser compatibility facade', () => {
  let tempDirectory: string;
  let executablePath: string;

  setup(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'map-elf-facade-'));
    executablePath = path.join(tempDirectory, 'firmware.elf');
    fs.writeFileSync(executablePath, 'ELF');
  });

  teardown(() => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  test('maps adapter analysis to the existing Region model', async () => {
    const parser = createParser(async command =>
      successfulResult(command === 'arm-none-eabi-objdump' ? objdumpOutput : nmOutput)
    );

    const regions = await parser.parse(fixture.inputPaths.map, executablePath);

    const ram = regions.find(region => region.name === 'RAM');
    const flash = regions.find(region => region.name === 'FLASH');
    assert.strictEqual(ram?.used, 0x18);
    assert.strictEqual(flash?.used, 0x30);
    assert.deepStrictEqual(
      flash?.sections[0].symbols.map(symbol => ({
        name: symbol.name,
        path: path.relative(tempDirectory, symbol.path).split(path.sep).join('/'),
        row: symbol.row,
      })),
      [
        { name: 'Reset_Handler', path: 'src/startup.c', row: 12 },
        { name: 'main', path: 'src/main.c', row: 42 },
      ]
    );
    assert.deepStrictEqual(parser.warnings, []);
  });

  test('retains warning strings when nm produces partial analysis', async () => {
    const parser = createParser(async command =>
      command === 'arm-none-eabi-objdump'
        ? successfulResult(objdumpOutput)
        : failedResult('symbol table unavailable')
    );

    const regions = await parser.parse(fixture.inputPaths.map, executablePath);

    assert.strictEqual(regions.find(region => region.name === 'FLASH')?.used, 0x30);
    assert.strictEqual(parser.warnings.length, 1);
    assert.match(parser.warnings[0], /symbol and source details are incomplete/);
  });

  test('continues to expose ToolExecutionError for fatal failures', async () => {
    const parser = createParser(async () => failedResult('not an ELF file'));

    await assert.rejects(
      parser.parse(fixture.inputPaths.map, executablePath),
      error => error instanceof ToolExecutionError
        && error.tool === 'arm-none-eabi-objdump'
        && /not an ELF file/.test(error.message)
    );
  });

  function createParser(toolRunner: ToolRunner): MapElfParser {
    const resolver: ToolResolver = {
      resolve: tool => ({ command: tool, source: 'path' }),
    };
    return new MapElfParser('', false, toolRunner, resolver);
  }
});

function successfulResult(stdout: string): ToolRunResult {
  return {
    stdout: Buffer.from(stdout),
    stderr: Buffer.alloc(0),
    status: 0,
    signal: null,
  };
}

function failedResult(stderr: string): ToolRunResult {
  return {
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(stderr),
    status: 1,
    signal: null,
  };
}
