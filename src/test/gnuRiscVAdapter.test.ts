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
  GnuRiscVAdapter,
} from '../toolchains/gnu-riscv/GnuRiscVAdapter';
import { defineGnuAdapterContract } from './contracts/gnuAdapterContract';
import {
  loadToolchainFixtures,
  ToolchainFixture,
} from './fixtures/fixtureLoader';

const OBJDUMP_TOOL = 'riscv64-unknown-elf-objdump';
const NM_TOOL = 'riscv64-unknown-elf-nm';
const analysisFixtures = loadToolchainFixtures().filter(candidate =>
  candidate.manifest.toolchain === 'gnu-riscv-none-elf'
  && candidate.manifest.kind === 'analysis'
);
const realFixture = analysisFixtures.find(candidate =>
  candidate.manifest.id === 'gnu-riscv-real-minimal-rv32'
);
if (!realFixture || analysisFixtures.length < 2) {
  throw new Error('Missing GNU RISC-V synthetic and real analysis fixtures');
}

defineGnuAdapterContract({
  name: 'shared GNU/binutils adapter contract (GNU RISC-V)',
  toolchainId: 'gnu-riscv-none-elf',
  displayName: 'GNU RISC-V Embedded',
  targetArchitecture: 'RISC-V',
  objdumpTool: OBJDUMP_TOOL,
  nmTool: NM_TOOL,
  createAdapter: (toolRunner, toolResolver) => new GnuRiscVAdapter('', false, {
    toolPrefix: 'riscv64-unknown-elf-',
    toolRunner,
    toolResolver,
  }),
});

suite('GnuRiscVAdapter', () => {
  let temporaryDirectory: string;
  let syntheticExecutable: string;

  setup(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gnu-riscv-'));
    syntheticExecutable = path.join(temporaryDirectory, 'firmware.elf');
    fs.writeFileSync(syntheticExecutable, Buffer.from('ELF\0synthetic-riscv'));
  });

  teardown(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
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
        id: 'gnu-riscv-none-elf',
        displayName: 'GNU RISC-V Embedded',
        targetArchitecture: 'RISC-V',
      });
    });
  }

  test('real fixture is an ELF32 RISC-V executable', async () => {
    const inspector = new FileArtifactInspector();
    const header = await inspector.readBytes(realFixture.inputPaths.executable, 64);

    assert.deepStrictEqual(parseElfMetadata(header), {
      machine: 243,
      bitness: 32,
      littleEndian: true,
    });
  });

  test('discovers a configured riscv32-none-elf tool prefix', async () => {
    const binDirectory = path.join(temporaryDirectory, 'bin');
    fs.mkdirSync(binDirectory);
    for (const tool of ['objdump', 'nm']) {
      fs.writeFileSync(path.join(
        binDirectory,
        `riscv32-none-elf-${tool}`
      ), '');
    }
    const commands: string[] = [];
    const adapter = new GnuRiscVAdapter(binDirectory, false, {
      toolRunner: async command => {
        commands.push(command);
        return successfulResult(`${path.basename(command)} 2.42`);
      },
    });

    const validation = await adapter.validateEnvironment({
      mapPath: realFixture.inputPaths.map,
      executablePath: realFixture.inputPaths.executable,
      linkerScriptPaths: [realFixture.inputPaths.linkerScript],
      workspaceFolder: realFixture.caseDirectory,
    });

    assert.strictEqual(validation.status, 'valid');
    assert.deepStrictEqual(commands.map(command => path.basename(command)), [
      'riscv32-none-elf-objdump',
      'riscv32-none-elf-nm',
    ]);
  });

  test('default orchestrator detects and analyzes the real fixture', async () => {
    const result = await createDefaultAnalysisOrchestrator({
      toolchainPath: '',
      adapterDependencies: {
        gnuRiscV: {
          toolPrefix: 'riscv64-unknown-elf-',
          toolRunner: fixtureRunner(realFixture),
          toolResolver: directResolver(),
        },
      },
    }).analyze({
      mapPath: realFixture.inputPaths.map,
      executablePath: realFixture.inputPaths.executable,
      linkerScriptPaths: [realFixture.inputPaths.linkerScript],
      workspaceFolder: realFixture.caseDirectory,
    });

    if (result.status !== 'success') {
      assert.fail(`Expected success, received ${result.status}`);
    }
    assert.strictEqual(result.detection.toolchainId, 'gnu-riscv-none-elf');
    assert.strictEqual(result.analysis.toolchain.id, 'gnu-riscv-none-elf');
    assert.strictEqual(result.analysis.regions.length, 2);
  });
});

interface ExpectedAnalysisFixture {
  readonly regions: unknown;
  readonly warnings: unknown[];
}

function createAdapter(toolRunner: ToolRunner): GnuRiscVAdapter {
  return new GnuRiscVAdapter('', false, {
    toolPrefix: 'riscv64-unknown-elf-',
    toolRunner,
    toolResolver: directResolver(),
  });
}

function fixtureRunner(fixture: ToolchainFixture): ToolRunner {
  const objdumpOutput = fs.readFileSync(fixture.inputPaths.objdumpStdout, 'utf8');
  const nmOutput = fs.readFileSync(fixture.inputPaths.nmStdout, 'utf8');
  return async (command, arguments_) => {
    if (arguments_[0] === '--version') {
      return successfulResult(`${command} (GNU Binutils) 2.42`);
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
