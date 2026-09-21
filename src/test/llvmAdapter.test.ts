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
import { GnuBinutilsParser } from '../toolchains/gnu/GnuBinutilsParser';
import { GnuLinkerMapParser } from '../toolchains/gnu/GnuLinkerMapParser';
import { LlvmAdapter } from '../toolchains/llvm/LlvmAdapter';
import { LlvmLldMapParser } from '../toolchains/llvm/LlvmLldMapParser';
import { defineGnuAdapterContract } from './contracts/gnuAdapterContract';
import {
  loadToolchainFixtures,
  ToolchainFixture,
} from './fixtures/fixtureLoader';

const OBJDUMP_TOOL = 'llvm-objdump';
const NM_TOOL = 'llvm-nm';
const analysisFixtures = loadToolchainFixtures().filter(candidate =>
  candidate.manifest.toolchain === 'llvm'
  && candidate.manifest.kind === 'analysis'
);
const realFixture = analysisFixtures.find(candidate =>
  candidate.manifest.id === 'llvm-lld-real-minimal-arm'
);
if (!realFixture || analysisFixtures.length !== 2) {
  throw new Error('Missing LLVM synthetic or real analysis fixtures');
}

defineGnuAdapterContract({
  name: 'shared bounded binutils workflow contract (LLVM)',
  toolchainId: 'llvm',
  displayName: 'LLVM/Clang Embedded',
  targetArchitecture: 'LLVM ELF target',
  objdumpTool: OBJDUMP_TOOL,
  nmTool: NM_TOOL,
  createAdapter: (toolRunner, toolResolver) => new LlvmAdapter('', false, {
    toolRunner,
    toolResolver,
    mapParser: new GnuLinkerMapParser(),
    binutilsParser: new GnuBinutilsParser(),
  }),
});

suite('LlvmAdapter', () => {
  let temporaryDirectory: string;
  let syntheticExecutable: string;

  setup(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'llvm-adapter-'));
    syntheticExecutable = path.join(temporaryDirectory, 'firmware.elf');
    fs.writeFileSync(syntheticExecutable, Buffer.from('ELF\0synthetic-llvm'));
  });

  teardown(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  for (const fixture of analysisFixtures) {
    test(`produces expected analysis for ${fixture.manifest.id}`, async () => {
      const executablePath = fixture.inputPaths.executable ?? syntheticExecutable;
      const analysis = await createAdapter(fixtureRunner(fixture)).analyze({
        mapPath: fixture.inputPaths.map,
        executablePath,
        linkerScriptPaths: [fixture.inputPaths.linkerScript],
        workspaceFolder: fixture.caseDirectory,
      });

      assert.deepStrictEqual(
        normalizeRegions(analysis.regions, path.dirname(executablePath)),
        (fixture.expected as ExpectedAnalysisFixture).regions
      );
      assert.deepStrictEqual(
        analysis.warnings,
        (fixture.expected as ExpectedAnalysisFixture).warnings
      );
      assert.deepStrictEqual(analysis.toolchain, {
        id: 'llvm',
        displayName: 'LLVM/Clang Embedded',
        targetArchitecture: 'LLVM ELF target',
      });
    });
  }

  test('real fixture is an ELF32 little-endian Arm executable', async () => {
    const inspector = new FileArtifactInspector();
    const header = await inspector.readBytes(realFixture.inputPaths.executable, 64);

    assert.deepStrictEqual(parseElfMetadata(header), {
      machine: 40,
      bitness: 32,
      littleEndian: true,
    });
  });

  test('rejects computed MEMORY expressions instead of guessing capacity', () => {
    const mapPath = path.join(temporaryDirectory, 'computed.map');
    const scriptPath = path.join(temporaryDirectory, 'computed.ld');
    fs.writeFileSync(mapPath,
      ' VMA LMA Size Align Out In Symbol\n', 'utf8');
    fs.writeFileSync(scriptPath, [
      'MEMORY {',
      '  FLASH : ORIGIN = 0x08000000, LENGTH = FLASH_SIZE - 4K',
      '}',
    ].join('\n'), 'utf8');

    assert.throws(
      () => new LlvmLldMapParser().parseFile(mapPath, [scriptPath]),
      /unsupported length expression/
    );
  });

  test('uses LLVM tools even when GNU tools are also available', async () => {
    const commands: string[] = [];
    const adapter = createAdapter(async (command, arguments_) => {
      commands.push(command);
      if (arguments_[0] === '-h') {
        return successfulResult(fs.readFileSync(
          realFixture.inputPaths.objdumpStdout,
          'utf8'
        ));
      }
      return successfulResult(fs.readFileSync(
        realFixture.inputPaths.nmStdout,
        'utf8'
      ));
    });

    await adapter.analyze(artifactSet(realFixture));

    assert.deepStrictEqual(commands, [OBJDUMP_TOOL, NM_TOOL]);
  });

  test('default orchestrator detects and analyzes native LLD output', async () => {
    const result = await createDefaultAnalysisOrchestrator({
      toolchainPath: '',
      adapterDependencies: {
        llvm: {
          toolRunner: fixtureRunner(realFixture),
          toolResolver: directResolver(),
        },
      },
    }).analyze(artifactSet(realFixture));

    if (result.status !== 'success') {
      assert.fail(`Expected success, received ${result.status}`);
    }
    assert.strictEqual(result.detection.toolchainId, 'llvm');
    assert.strictEqual(result.analysis.toolchain.id, 'llvm');
    assert.strictEqual(result.analysis.regions.length, 2);
  });
});

interface ExpectedAnalysisFixture {
  readonly regions: unknown;
  readonly warnings: unknown[];
}

function createAdapter(toolRunner: ToolRunner): LlvmAdapter {
  return new LlvmAdapter('', false, {
    toolRunner,
    toolResolver: directResolver(),
  });
}

function artifactSet(fixture: ToolchainFixture) {
  return {
    mapPath: fixture.inputPaths.map,
    executablePath: fixture.inputPaths.executable,
    linkerScriptPaths: [fixture.inputPaths.linkerScript],
    workspaceFolder: fixture.caseDirectory,
  };
}

function fixtureRunner(fixture: ToolchainFixture): ToolRunner {
  const objdumpOutput = fs.readFileSync(fixture.inputPaths.objdumpStdout, 'utf8');
  const nmOutput = fs.readFileSync(fixture.inputPaths.nmStdout, 'utf8');
  return async (command, arguments_) => {
    if (arguments_[0] === '--version') {
      return successfulResult(`Ubuntu LLVM version 18.1.3 (${command})`);
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
