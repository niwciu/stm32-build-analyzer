import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AnalyzedMemoryRegion } from '../analysis/contracts';
import { ANALYSIS_DIAGNOSTIC_CODES } from '../analysis/diagnostics';
import type { ToolResolver } from '../process/ToolResolver';
import type { ToolRunner, ToolRunResult } from '../process/ToolRunner';
import { GnuArmAdapter } from '../toolchains/gnu-arm/GnuArmAdapter';
import { ToolExecutionError } from '../toolchains/gnu/GnuBinutilsAdapter';
import { AnalysisCancelledError } from '../utils/errors';
import { defineGnuAdapterContract } from './contracts/gnuAdapterContract';
import { loadToolchainFixtures } from './fixtures/fixtureLoader';

interface ExpectedAnalysisFixture {
  regions: unknown;
  warnings: unknown[];
}

const gnuArmAnalysisFixtures = loadToolchainFixtures().filter(candidate =>
  candidate.manifest.toolchain === 'gnu-arm-none-eabi'
  && candidate.manifest.kind === 'analysis'
);
const fixture = gnuArmAnalysisFixtures.find(candidate =>
  candidate.manifest.id === 'gnu-arm-synthetic-minimal'
);
if (!fixture || gnuArmAnalysisFixtures.length === 0) {
  throw new Error('Missing gnu-arm-synthetic-minimal fixture');
}
const mapPath = fixture.inputPaths.map;
const objdumpOutput = fs.readFileSync(fixture.inputPaths.objdumpStdout, 'utf8');
const nmOutput = fs.readFileSync(fixture.inputPaths.nmStdout, 'utf8');

defineGnuAdapterContract({
  name: 'shared GNU/binutils adapter contract (GNU Arm)',
  toolchainId: 'gnu-arm-none-eabi',
  displayName: 'GNU Arm Embedded',
  targetArchitecture: 'Arm',
  objdumpTool: 'arm-none-eabi-objdump',
  nmTool: 'arm-none-eabi-nm',
  createAdapter: (toolRunner, toolResolver) => new GnuArmAdapter('', false, {
    toolRunner,
    toolResolver,
  }),
});

suite('GnuArmAdapter', () => {
  let tempDirectory: string;
  let executablePath: string;

  setup(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gnu-arm-adapter-'));
    executablePath = path.join(tempDirectory, 'firmware.elf');
    fs.writeFileSync(executablePath, Buffer.from('ELF\0synthetic'));
  });

  teardown(() => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  for (const analysisFixture of gnuArmAnalysisFixtures) {
    test(`produces expected analysis for ${analysisFixture.manifest.id}`, async () => {
      const expected = analysisFixture.expected as ExpectedAnalysisFixture;
      const fixtureObjdump = fs.readFileSync(
        analysisFixture.inputPaths.objdumpStdout,
        'utf8'
      );
      const fixtureNm = fs.readFileSync(analysisFixture.inputPaths.nmStdout, 'utf8');
      const runner: ToolRunner = async command => successfulResult(
        command === 'arm-none-eabi-objdump' ? fixtureObjdump : fixtureNm
      );
      const adapter = createAdapter(runner);

      const analysis = await adapter.analyze({
        mapPath: analysisFixture.inputPaths.map,
        executablePath,
        linkerScriptPaths: [],
        workspaceFolder: tempDirectory,
      });

      assert.deepStrictEqual(normalizeRegions(analysis.regions), expected.regions);
      assert.deepStrictEqual(analysis.warnings, expected.warnings);
      assert.strictEqual(analysis.toolchain.id, 'gnu-arm-none-eabi');
      assert.strictEqual(analysis.toolchain.displayName, 'GNU Arm Embedded');
      assert.strictEqual(analysis.toolchain.targetArchitecture, 'Arm');
      assert.strictEqual(analysis.provenance.adapterId, 'gnu-arm-none-eabi');
      assert.deepStrictEqual(
        analysis.provenance.toolInvocations.map(invocation => invocation.arguments),
        [
          ['-h', executablePath],
          ['-C', '-S', '-n', '-l', '--defined-only', executablePath],
        ]
      );
    });
  }

  test('analyzes a temporary executable copy and removes it afterward', async () => {
    const pathsSeen: string[] = [];
    const runner = fixtureRunner((_, arguments_) => {
      const toolPath = arguments_[arguments_.length - 1];
      pathsSeen.push(toolPath);
      assert.ok(fs.existsSync(toolPath));
    });
    const originalBytes = fs.readFileSync(executablePath);

    await createAdapter(runner).analyze(artifacts());

    assert.strictEqual(pathsSeen.length, 2);
    assert.ok(pathsSeen.every(seen => seen !== executablePath));
    assert.ok(pathsSeen.every(seen => !fs.existsSync(seen)));
    assert.ok(originalBytes.equals(fs.readFileSync(executablePath)));
  });

  test('cleans up the executable copy when objdump fails', async () => {
    let copiedPath: string | undefined;
    const runner: ToolRunner = async (_command, arguments_) => {
      copiedPath = arguments_[arguments_.length - 1];
      return failedResult('not an ELF file');
    };

    await assert.rejects(
      createAdapter(runner).analyze(artifacts()),
      ToolExecutionError
    );

    assert.ok(copiedPath);
    assert.notStrictEqual(copiedPath, executablePath);
    assert.ok(!fs.existsSync(copiedPath!));
  });

  test('falls back to the original executable when copying fails', async () => {
    const missingExecutable = path.join(tempDirectory, 'missing.elf');
    const pathsSeen: string[] = [];
    const runner = fixtureRunner((_command, arguments_) => {
      pathsSeen.push(arguments_[arguments_.length - 1]);
    });

    const analysis = await createAdapter(runner).analyze({
      mapPath,
      executablePath: missingExecutable,
      linkerScriptPaths: [],
    });

    assert.deepStrictEqual(pathsSeen, [missingExecutable, missingExecutable]);
    assert.strictEqual(analysis.provenance.notes.length, 1);
    assert.match(analysis.provenance.notes[0], /analyzed original/);
  });

  test('preserves memory usage and reports partial analysis when nm fails', async () => {
    const runner: ToolRunner = async command =>
      command === 'arm-none-eabi-objdump'
        ? successfulResult(objdumpOutput)
        : failedResult('symbol table unavailable');

    const analysis = await createAdapter(runner).analyze(artifacts());

    const flash = analysis.regions.find(region => region.name === 'FLASH');
    assert.strictEqual(flash?.used, 0x30);
    assert.strictEqual(analysis.warnings.length, 1);
    assert.strictEqual(
      analysis.warnings[0].code,
      ANALYSIS_DIAGNOSTIC_CODES.ANALYSIS_PARTIAL
    );
    assert.match(analysis.warnings[0].message, /symbol and source details are incomplete/);
  });

  test('returns partial environment validation when optional nm is unavailable', async () => {
    const runner: ToolRunner = async command =>
      command === 'arm-none-eabi-objdump'
        ? successfulResult('GNU objdump 2.42\nCopyright')
        : failedResult('missing');

    const validation = await createAdapter(runner).validateEnvironment(artifacts());

    assert.strictEqual(validation.status, 'partial');
    assert.strictEqual(validation.tools[0].version, 'GNU objdump 2.42');
    assert.strictEqual(validation.tools[1].required, false);
    assert.strictEqual(validation.diagnostics.length, 1);
  });

  test('returns invalid environment validation when objdump is unavailable', async () => {
    const runner: ToolRunner = async command =>
      command === 'arm-none-eabi-nm'
        ? successfulResult('GNU nm 2.42')
        : failedResult('missing');

    const validation = await createAdapter(runner).validateEnvironment(artifacts());

    assert.strictEqual(validation.status, 'invalid');
    assert.strictEqual(validation.diagnostics.length, 1);
  });

  test('warns when configured binaries fall back to PATH', async () => {
    const resolver: ToolResolver = {
      resolve: tool => ({
        command: tool,
        source: 'path',
        configuredCandidate: path.join('/configured', 'bin', tool),
      }),
    };
    const adapter = new GnuArmAdapter('/configured/bin', false, {
      toolRunner: async command => successfulResult(
        command === 'arm-none-eabi-objdump' ? 'GNU objdump 2.42' : 'GNU nm 2.42'
      ),
      toolResolver: resolver,
    });

    const validation = await adapter.validateEnvironment(artifacts());

    assert.strictEqual(validation.status, 'valid');
    assert.strictEqual(validation.diagnostics.length, 2);
    assert.ok(validation.diagnostics.every(diagnostic =>
      diagnostic.code === ANALYSIS_DIAGNOSTIC_CODES.ANALYSIS_PARTIAL
      && diagnostic.message.includes('falling back to PATH')
    ));
  });

  test('provides actionable structured errors for fatal tool failures', async () => {
    const runner: ToolRunner = async () => failedResult('not an ELF file');

    await assert.rejects(
      createAdapter(runner).analyze(artifacts()),
      error => {
        assert.ok(error instanceof ToolExecutionError);
        assert.strictEqual(error.tool, 'arm-none-eabi-objdump');
        assert.match(error.message, /not an ELF file/);
        assert.match(error.message, /stm32BuildAnalyzerEnhanced\.toolchainPath/);
        assert.strictEqual(
          error.diagnostic.code,
          ANALYSIS_DIAGNOSTIC_CODES.TOOL_EXECUTION_FAILED
        );
        return true;
      }
    );
  });

  test('preserves cancellation before analysis starts', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      createAdapter(fixtureRunner()).analyze(artifacts(), controller.signal),
      AnalysisCancelledError
    );
  });

  test('requires both MAP and executable artifacts', async () => {
    const adapter = createAdapter(fixtureRunner());

    await assert.rejects(
      adapter.analyze({ linkerScriptPaths: [], executablePath }),
      /requires a MAP artifact/
    );
    await assert.rejects(
      adapter.analyze({ linkerScriptPaths: [], mapPath }),
      /requires a executable artifact/
    );
  });

  function artifacts() {
    return {
      mapPath,
      executablePath,
      linkerScriptPaths: [],
      workspaceFolder: tempDirectory,
    };
  }

  function normalizeRegions(regions: readonly AnalyzedMemoryRegion[]): unknown {
    return regions.map(region => ({
      ...region,
      sections: region.sections.map(section => ({
        ...section,
        symbols: section.symbols.map(symbol => ({
          ...symbol,
          source: symbol.source
            ? {
              ...symbol.source,
              path: path.relative(tempDirectory, symbol.source.path).split(path.sep).join('/'),
            }
            : undefined,
        })),
      })),
    }));
  }
});

function createAdapter(toolRunner: ToolRunner): GnuArmAdapter {
  return new GnuArmAdapter('', false, {
    toolRunner,
    toolResolver: directResolver(),
  });
}

function directResolver(): ToolResolver {
  return {
    resolve: tool => ({ command: tool, source: 'path' }),
  };
}

function fixtureRunner(
  inspect?: (command: string, arguments_: readonly string[]) => void
): ToolRunner {
  return async (command, arguments_) => {
    inspect?.(command, arguments_);
    if (command === 'arm-none-eabi-objdump') {
      return successfulResult(objdumpOutput);
    }
    if (command === 'arm-none-eabi-nm') {
      return successfulResult(nmOutput);
    }
    return failedResult(`Unexpected command: ${command}`);
  };
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
