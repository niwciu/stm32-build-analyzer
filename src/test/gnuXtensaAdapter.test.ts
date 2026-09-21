import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AnalyzedMemoryRegion } from '../analysis/contracts';
import { createDefaultAnalysisOrchestrator } from '../analysis/AnalysisOrchestrator';
import { FileArtifactInspector } from '../artifacts/ArtifactInspector';
import { parseElfMetadata } from '../artifacts/ElfMetadata';
import type { ToolResolver } from '../process/ToolResolver';
import type { ToolRunner, ToolRunResult } from '../process/ToolRunner';
import {
  GNU_XTENSA_TOOL_PREFIXES,
  GnuXtensaAdapter,
} from '../toolchains/gnu-xtensa/GnuXtensaAdapter';
import { defineGnuAdapterContract } from './contracts/gnuAdapterContract';
import {
  loadToolchainFixtures,
  ToolchainFixture,
} from './fixtures/fixtureLoader';

const OBJDUMP_TOOL = 'xtensa-esp-elf-objdump';
const NM_TOOL = 'xtensa-esp-elf-nm';
const analysisFixtures = loadToolchainFixtures().filter(candidate =>
  candidate.manifest.toolchain === 'gnu-xtensa-elf'
  && candidate.manifest.kind === 'analysis'
);
const realFixtures = analysisFixtures.filter(candidate =>
  candidate.manifest.origin.type === 'real'
);
if (realFixtures.length !== 3 || analysisFixtures.length !== 4) {
  throw new Error('Missing GNU Xtensa synthetic or ESP32 target fixtures');
}

defineGnuAdapterContract({
  name: 'shared GNU/binutils adapter contract (GNU Xtensa)',
  toolchainId: 'gnu-xtensa-elf',
  displayName: 'GNU Xtensa Embedded',
  targetArchitecture: 'Xtensa / ESP32',
  objdumpTool: OBJDUMP_TOOL,
  nmTool: NM_TOOL,
  createAdapter: (toolRunner, toolResolver) => new GnuXtensaAdapter('', false, {
    toolPrefix: 'xtensa-esp-elf-',
    toolRunner,
    toolResolver,
  }),
});

suite('GnuXtensaAdapter', () => {
  let temporaryDirectory: string;
  let syntheticExecutable: string;

  setup(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gnu-xtensa-'));
    syntheticExecutable = path.join(temporaryDirectory, 'firmware.elf');
    fs.writeFileSync(syntheticExecutable, Buffer.from('ELF\0synthetic-xtensa'));
  });

  teardown(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test('limits discovery to the verified Espressif Xtensa prefixes', () => {
    assert.deepStrictEqual([...GNU_XTENSA_TOOL_PREFIXES], [
      'xtensa-esp-elf-',
      'xtensa-esp32-elf-',
      'xtensa-esp32s2-elf-',
      'xtensa-esp32s3-elf-',
    ]);
  });

  for (const fixture of analysisFixtures) {
    test(`produces expected analysis for ${fixture.manifest.id}`, async () => {
      const executablePath = fixture.inputPaths.executable ?? syntheticExecutable;
      const sourceBase = path.dirname(executablePath);
      const analysis = await createAdapter(fixtureRunner(fixture)).analyze({
        mapPath: fixture.inputPaths.map,
        executablePath,
        linkerScriptPaths: fixture.inputPaths.linkerScript
          ? [fixture.inputPaths.linkerScript]
          : [],
        workspaceFolder: fixture.caseDirectory,
      });

      assert.deepStrictEqual(
        normalizeRegions(analysis.regions, sourceBase),
        (fixture.expected as ExpectedAnalysisFixture).regions
      );
      assert.deepStrictEqual(
        analysis.warnings,
        (fixture.expected as ExpectedAnalysisFixture).warnings
      );
      assert.deepStrictEqual(analysis.toolchain, {
        id: 'gnu-xtensa-elf',
        displayName: 'GNU Xtensa Embedded',
        targetArchitecture: 'Xtensa / ESP32',
      });
    });
  }

  for (const fixture of realFixtures) {
    test(`${fixture.manifest.id} is an ELF32 Xtensa executable`, async () => {
      const inspector = new FileArtifactInspector();
      const header = await inspector.readBytes(fixture.inputPaths.executable, 64);

      assert.deepStrictEqual(parseElfMetadata(header), {
        machine: 94,
        bitness: 32,
        littleEndian: true,
      });
    });
  }

  test('discovers a configured legacy ESP32-S3 tool prefix', async () => {
    const binDirectory = path.join(temporaryDirectory, 'bin');
    fs.mkdirSync(binDirectory);
    for (const tool of ['objdump', 'nm']) {
      fs.writeFileSync(path.join(
        binDirectory,
        `xtensa-esp32s3-elf-${tool}`
      ), '');
    }
    const commands: string[] = [];
    const adapter = new GnuXtensaAdapter(binDirectory, false, {
      toolRunner: async command => {
        commands.push(command);
        return successfulResult(`${path.basename(command)} 2.46`);
      },
    });

    const validation = await adapter.validateEnvironment(
      artifactSet(realFixtures[2])
    );

    assert.strictEqual(validation.status, 'valid');
    assert.deepStrictEqual(commands.map(command => path.basename(command)), [
      'xtensa-esp32s3-elf-objdump',
      'xtensa-esp32s3-elf-nm',
    ]);
  });

  test('default orchestrator detects and analyzes an ESP32 fixture', async () => {
    const fixture = realFixtures.find(candidate =>
      candidate.manifest.id === 'gnu-xtensa-real-minimal-esp32'
    );
    if (!fixture) {
      assert.fail('Missing real ESP32 fixture');
    }
    const result = await createDefaultAnalysisOrchestrator({
      toolchainPath: '',
      adapterDependencies: {
        gnuXtensa: {
          toolPrefix: 'xtensa-esp-elf-',
          toolRunner: fixtureRunner(fixture),
          toolResolver: directResolver(),
        },
      },
    }).analyze(artifactSet(fixture));

    if (result.status !== 'success') {
      assert.fail(`Expected success, received ${result.status}`);
    }
    assert.strictEqual(result.detection.toolchainId, 'gnu-xtensa-elf');
    assert.strictEqual(result.analysis.toolchain.id, 'gnu-xtensa-elf');
    assert.strictEqual(result.analysis.regions.length, 2);
  });
});

interface ExpectedAnalysisFixture {
  readonly regions: unknown;
  readonly warnings: unknown[];
}

function createAdapter(toolRunner: ToolRunner): GnuXtensaAdapter {
  return new GnuXtensaAdapter('', false, {
    toolPrefix: 'xtensa-esp-elf-',
    toolRunner,
    toolResolver: directResolver(),
  });
}

function artifactSet(fixture: ToolchainFixture) {
  return {
    mapPath: fixture.inputPaths.map,
    executablePath: fixture.inputPaths.executable,
    linkerScriptPaths: fixture.inputPaths.linkerScript
      ? [fixture.inputPaths.linkerScript]
      : [],
    workspaceFolder: fixture.caseDirectory,
  };
}

function fixtureRunner(fixture: ToolchainFixture): ToolRunner {
  const objdumpOutput = fs.readFileSync(fixture.inputPaths.objdumpStdout, 'utf8');
  const nmOutput = fs.readFileSync(fixture.inputPaths.nmStdout, 'utf8');
  return async (command, arguments_) => {
    if (arguments_[0] === '--version') {
      return successfulResult(`${command} (GNU Binutils) 2.46`);
    }
    if (command === OBJDUMP_TOOL) {
      return successfulResult(objdumpOutput);
    }
    if (command === NM_TOOL) {
      return successfulResult(nmOutput);
    }
    return failedResult(`Unexpected command: ${command}`);
  };
}

function directResolver(): ToolResolver {
  return {
    resolve: tool => ({ command: tool, source: 'path' }),
  };
}

function normalizeRegions(
  regions: readonly AnalyzedMemoryRegion[],
  sourceBase: string
): unknown {
  return regions.map(region => ({
    ...region,
    sections: region.sections.map(section => ({
      ...section,
      symbols: section.symbols.map(symbol => ({
        name: symbol.name,
        startAddress: symbol.startAddress,
        size: symbol.size,
        ...(symbol.source
          ? { source: {
            ...symbol.source,
            path: path.relative(sourceBase, symbol.source.path)
              .split(path.sep).join('/'),
          } }
          : {}),
      })),
    })),
  }));
}

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
