import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AdapterRegistry,
  createDefaultAdapterRegistry,
} from '../analysis/AdapterRegistry';
import {
  AnalysisOrchestrator,
  getToolchainDisplayName,
  ToolchainDetectionService,
} from '../analysis/AnalysisOrchestrator';
import type {
  BuildAnalysis,
  BuildAnalysisResult,
  EnvironmentValidation,
  KnownToolchainId,
  ToolchainAdapter,
  ToolchainDetection,
} from '../analysis/contracts';
import { createDefaultDetectionRegistry } from '../analysis/DetectionRegistry';
import {
  ANALYSIS_DIAGNOSTIC_CODES,
  AnalysisDiagnostic,
  createAnalysisDiagnostic,
} from '../analysis/diagnostics';
import type { BuildArtifactSet } from '../artifacts/BuildArtifactSet';
import {
  BuildArtifactValidator,
  FileSystemBuildArtifactValidator,
} from '../artifacts/BuildArtifactValidator';
import { AnalysisCancelledError } from '../utils/errors';
import {
  loadToolchainFixtures,
  ToolchainFixture,
} from './fixtures/fixtureLoader';

const artifacts: BuildArtifactSet = {
  mapPath: '/build/firmware.map',
  executablePath: '/build/firmware.elf',
  linkerScriptPaths: [],
};

const acceptingValidator: BuildArtifactValidator = {
  validate: async () => [],
};

suite('AdapterRegistry', () => {
  test('indexes adapters deterministically', () => {
    const registry = new AdapterRegistry([
      fakeAdapter('llvm'),
      fakeAdapter('gnu-arm-none-eabi'),
    ]);

    assert.deepStrictEqual(registry.toolchainIds, [
      'gnu-arm-none-eabi',
      'llvm',
    ]);
    assert.strictEqual(registry.has('llvm'), true);
    assert.strictEqual(registry.get('iar-arm'), undefined);
  });

  test('rejects duplicate adapter IDs', () => {
    assert.throws(() => new AdapterRegistry([
      fakeAdapter('gnu-arm-none-eabi'),
      fakeAdapter('gnu-arm-none-eabi'),
    ]), /Duplicate adapter/);
  });

  test('the Phase 2 default registry contains GNU Arm and GNU RISC-V', () => {
    assert.deepStrictEqual(
      createDefaultAdapterRegistry('').toolchainIds,
      ['gnu-arm-none-eabi', 'gnu-riscv-none-elf']
    );
  });
});

suite('FileSystemBuildArtifactValidator', () => {
  test('reports both absent required artifact paths', async () => {
    const diagnostics = await new FileSystemBuildArtifactValidator().validate({
      linkerScriptPaths: [],
    });

    assert.strictEqual(diagnostics.length, 2);
    assert.ok(diagnostics.every(diagnostic =>
      diagnostic.code === ANALYSIS_DIAGNOSTIC_CODES.ARTIFACT_MISSING
    ));
  });

  test('accepts readable regular files', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-set-'));
    const mapPath = path.join(directory, 'firmware.map');
    const executablePath = path.join(directory, 'firmware.elf');
    fs.writeFileSync(mapPath, 'map', 'utf8');
    fs.writeFileSync(executablePath, 'elf', 'utf8');

    try {
      const diagnostics = await new FileSystemBuildArtifactValidator().validate({
        mapPath,
        executablePath,
        linkerScriptPaths: [],
      });
      assert.deepStrictEqual(diagnostics, []);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects missing files and directories', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-set-'));
    const missingPath = path.join(directory, 'missing.map');

    try {
      const diagnostics = await new FileSystemBuildArtifactValidator().validate({
        mapPath: missingPath,
        executablePath: directory,
        linkerScriptPaths: [],
      });
      assert.strictEqual(diagnostics.length, 2);
      assert.ok(diagnostics.every(diagnostic =>
        diagnostic.code === ANALYSIS_DIAGNOSTIC_CODES.ARTIFACT_UNREADABLE
      ));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('preserves cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      new FileSystemBuildArtifactValidator().validate(
        artifacts,
        controller.signal
      ),
      AnalysisCancelledError
    );
  });
});

suite('AnalysisOrchestrator unsupported toolchains', () => {
  const unsupportedFixtures = loadToolchainFixtures().filter(fixture =>
    fixture.manifest.kind === 'detection'
    && fixture.manifest.toolchain !== 'unknown'
    && fixture.manifest.toolchain !== 'gnu-arm-none-eabi'
  );

  for (const fixture of unsupportedFixtures) {
    test(`does not route ${fixture.manifest.toolchain} through GNU Arm`, async () => {
      const calls = { validate: 0, analyze: 0 };
      const gnuAdapter = fakeAdapter('gnu-arm-none-eabi', { calls });
      const orchestrator = new AnalysisOrchestrator(
        createDefaultDetectionRegistry(),
        new AdapterRegistry([gnuAdapter]),
        { artifactValidator: acceptingValidator }
      );

      const result = await orchestrator.analyze(artifactsFor(fixture));

      assert.strictEqual(result.status, 'unsupported');
      assert.strictEqual(result.detection.toolchainId, fixture.manifest.toolchain);
      assert.deepStrictEqual(calls, { validate: 0, analyze: 0 });
      const diagnostic = result.diagnostics.find(candidate =>
        candidate.code === ANALYSIS_DIAGNOSTIC_CODES.TOOLCHAIN_UNSUPPORTED
      );
      assert.ok(diagnostic);
      assert.ok(diagnostic.message.includes(getToolchainDisplayName(
        result.detection.toolchainId as KnownToolchainId
      )));
      assert.ok(diagnostic.message.includes('not implemented'));
      assert.ok(diagnostic.remediation);
    });
  }

  test('routes a detected GNU Arm fixture through its registered adapter', async () => {
    const fixture = requiredFixture('detection-gnu-arm');
    const calls = { validate: 0, analyze: 0 };
    const orchestrator = new AnalysisOrchestrator(
      createDefaultDetectionRegistry(),
      new AdapterRegistry([fakeAdapter('gnu-arm-none-eabi', { calls })]),
      { artifactValidator: acceptingValidator }
    );

    const result = await orchestrator.analyze(artifactsFor(fixture));

    assert.strictEqual(result.status, 'success');
    assert.deepStrictEqual(calls, { validate: 1, analyze: 1 });
  });

  for (const [fixtureId, expectedStatus] of [
    ['detection-unknown-generic-gnu', 'unknown'],
    ['detection-ambiguous-arm-iar', 'ambiguous'],
  ] as const) {
    test(`returns ${expectedStatus} for ${fixtureId} without an adapter call`, async () => {
      const calls = { validate: 0, analyze: 0 };
      const orchestrator = new AnalysisOrchestrator(
        createDefaultDetectionRegistry(),
        new AdapterRegistry([fakeAdapter('gnu-arm-none-eabi', { calls })]),
        { artifactValidator: acceptingValidator }
      );

      const result = await orchestrator.analyze(
        artifactsFor(requiredFixture(fixtureId))
      );

      assert.strictEqual(result.status, expectedStatus);
      assert.deepStrictEqual(calls, { validate: 0, analyze: 0 });
    });
  }
});

suite('AnalysisOrchestrator result policy', () => {
  test('returns every result status through an explicit branch', async () => {
    const statuses: BuildAnalysisResult['status'][] = [];

    statuses.push((await orchestratorFor(
      detectedService('gnu-arm-none-eabi'),
      fakeAdapter('gnu-arm-none-eabi')
    ).analyze(artifacts)).status);

    statuses.push((await orchestratorFor(
      detectedService('gnu-arm-none-eabi'),
      fakeAdapter('gnu-arm-none-eabi', {
        environment: environment('partial', [partialDiagnostic()]),
      })
    ).analyze(artifacts)).status);

    statuses.push((await new AnalysisOrchestrator(
      detectedService('llvm'),
      new AdapterRegistry([]),
      { artifactValidator: acceptingValidator }
    ).analyze(artifacts)).status);

    statuses.push((await new AnalysisOrchestrator(
      inconclusiveService('unknown'),
      new AdapterRegistry([]),
      { artifactValidator: acceptingValidator }
    ).analyze(artifacts)).status);

    statuses.push((await new AnalysisOrchestrator(
      inconclusiveService('ambiguous'),
      new AdapterRegistry([]),
      { artifactValidator: acceptingValidator }
    ).analyze(artifacts)).status);

    statuses.push((await new AnalysisOrchestrator(
      detectedService('gnu-arm-none-eabi'),
      new AdapterRegistry([]),
      { artifactValidator: rejectingValidator() }
    ).analyze(artifacts)).status);

    const controller = new AbortController();
    controller.abort();
    statuses.push((await orchestratorFor(
      detectedService('gnu-arm-none-eabi'),
      fakeAdapter('gnu-arm-none-eabi')
    ).analyze(artifacts, controller.signal)).status);

    assert.deepStrictEqual(statuses, [
      'success',
      'partial',
      'unsupported',
      'unknown',
      'ambiguous',
      'invalid',
      'cancelled',
    ]);
  });

  test('validates artifacts before detection', async () => {
    let detectionCalls = 0;
    const detectionService: ToolchainDetectionService = {
      detect: async () => {
        detectionCalls += 1;
        return detectedReport('gnu-arm-none-eabi');
      },
    };
    const orchestrator = new AnalysisOrchestrator(
      detectionService,
      new AdapterRegistry([]),
      { artifactValidator: rejectingValidator() }
    );

    const result = await orchestrator.analyze(artifacts);

    assert.strictEqual(result.status, 'invalid');
    assert.strictEqual(detectionCalls, 0);
  });

  test('validates the environment only after selecting an adapter', async () => {
    const calls = { validate: 0, analyze: 0 };
    const adapter = fakeAdapter('gnu-arm-none-eabi', {
      calls,
      environment: environment('invalid', [missingToolDiagnostic()]),
    });
    const result = await orchestratorFor(
      detectedService('gnu-arm-none-eabi'),
      adapter
    ).analyze(artifacts);

    assert.strictEqual(result.status, 'invalid');
    assert.deepStrictEqual(calls, { validate: 1, analyze: 0 });
    assert.strictEqual(
      result.diagnostics[0].code,
      ANALYSIS_DIAGNOSTIC_CODES.REQUIRED_TOOL_MISSING
    );
  });

  test('marks adapter warnings as partial analysis', async () => {
    const adapter = fakeAdapter('gnu-arm-none-eabi', {
      analysis: analysis([partialDiagnostic()]),
    });
    const result = await orchestratorFor(
      detectedService('gnu-arm-none-eabi'),
      adapter
    ).analyze(artifacts);

    assert.strictEqual(result.status, 'partial');
    assert.strictEqual(result.analysis.warnings.length, 1);
    assert.ok(result.diagnostics.some(diagnostic =>
      diagnostic.code === ANALYSIS_DIAGNOSTIC_CODES.ANALYSIS_PARTIAL
    ));
  });

  test('converts cancellation from detection into a cancelled result', async () => {
    const detectionService: ToolchainDetectionService = {
      detect: async () => {
        throw new AnalysisCancelledError();
      },
    };
    const result = await new AnalysisOrchestrator(
      detectionService,
      new AdapterRegistry([]),
      { artifactValidator: acceptingValidator }
    ).analyze(artifacts);

    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(
      result.diagnostics[0].code,
      ANALYSIS_DIAGNOSTIC_CODES.ANALYSIS_CANCELLED
    );
  });

  test('preserves a structured adapter failure diagnostic', async () => {
    const diagnostic = createAnalysisDiagnostic({
      code: ANALYSIS_DIAGNOSTIC_CODES.TOOL_EXECUTION_FAILED,
      severity: 'error',
      message: 'objdump failed',
      toolchainId: 'gnu-arm-none-eabi',
    });
    const adapter = fakeAdapter('gnu-arm-none-eabi', {
      analyzeError: { diagnostic },
    });

    const result = await orchestratorFor(
      detectedService('gnu-arm-none-eabi'),
      adapter
    ).analyze(artifacts);

    assert.strictEqual(result.status, 'invalid');
    assert.deepStrictEqual(result.diagnostics, [diagnostic]);
  });

  test('normalizes an unexpected adapter exception into an invalid result', async () => {
    const adapter = fakeAdapter('gnu-arm-none-eabi', {
      analyzeError: new Error('unexpected parser failure'),
    });

    const result = await orchestratorFor(
      detectedService('gnu-arm-none-eabi'),
      adapter
    ).analyze(artifacts);

    assert.strictEqual(result.status, 'invalid');
    assert.strictEqual(
      result.diagnostics[0].code,
      ANALYSIS_DIAGNOSTIC_CODES.TOOL_EXECUTION_FAILED
    );
    assert.strictEqual(
      result.diagnostics[0].cause?.message,
      'unexpected parser failure'
    );
  });
});

interface FakeAdapterOptions {
  readonly calls?: { validate: number; analyze: number };
  readonly environment?: EnvironmentValidation;
  readonly analysis?: BuildAnalysis;
  readonly analyzeError?: unknown;
}

function fakeAdapter(
  toolchainId: KnownToolchainId,
  options: FakeAdapterOptions = {}
): ToolchainAdapter {
  return {
    toolchainId,
    validateEnvironment: async () => {
      if (options.calls) {
        options.calls.validate += 1;
      }
      return options.environment ?? environment('valid');
    },
    analyze: async () => {
      if (options.calls) {
        options.calls.analyze += 1;
      }
      if (options.analyzeError !== undefined) {
        throw options.analyzeError;
      }
      return options.analysis ?? analysis();
    },
  };
}

function analysis(
  warnings: readonly AnalysisDiagnostic[] = []
): BuildAnalysis {
  return {
    regions: [],
    toolchain: {
      id: 'gnu-arm-none-eabi',
      displayName: 'GNU Arm Embedded',
    },
    provenance: {
      adapterId: 'gnu-arm-none-eabi',
      artifacts,
      toolInvocations: [],
      notes: [],
    },
    warnings,
  };
}

function environment(
  status: EnvironmentValidation['status'],
  diagnostics: readonly AnalysisDiagnostic[] = []
): EnvironmentValidation {
  return { status, tools: [], diagnostics };
}

function detectedService(
  toolchainId: KnownToolchainId
): ToolchainDetectionService {
  return { detect: async () => detectedReport(toolchainId) };
}

function detectedReport(toolchainId: KnownToolchainId): {
  readonly status: 'detected';
  readonly detection: ToolchainDetection;
  readonly detections: readonly ToolchainDetection[];
  readonly diagnostics: readonly AnalysisDiagnostic[];
} {
  const detection: ToolchainDetection = {
    toolchainId,
    confidence: 0.9,
    evidence: [{
      source: 'file-content',
      description: `${toolchainId} test marker`,
      weight: 0.9,
    }],
    diagnostics: [],
  };
  return {
    status: 'detected',
    detection,
    detections: [detection],
    diagnostics: [],
  };
}

function inconclusiveService(
  status: 'unknown' | 'ambiguous'
): ToolchainDetectionService {
  return {
    detect: async () => ({
      status,
      detections: [],
      diagnostics: [createAnalysisDiagnostic({
        code: status === 'unknown'
          ? ANALYSIS_DIAGNOSTIC_CODES.TOOLCHAIN_UNKNOWN
          : ANALYSIS_DIAGNOSTIC_CODES.TOOLCHAIN_AMBIGUOUS,
        severity: 'warning',
        message: status,
      })],
    }),
  };
}

function orchestratorFor(
  detectionService: ToolchainDetectionService,
  adapter: ToolchainAdapter
): AnalysisOrchestrator {
  return new AnalysisOrchestrator(
    detectionService,
    new AdapterRegistry([adapter]),
    { artifactValidator: acceptingValidator }
  );
}

function rejectingValidator(): BuildArtifactValidator {
  return {
    validate: async () => [createAnalysisDiagnostic({
      code: ANALYSIS_DIAGNOSTIC_CODES.ARTIFACT_MISSING,
      severity: 'error',
      message: 'missing artifacts',
    })],
  };
}

function missingToolDiagnostic(): AnalysisDiagnostic {
  return createAnalysisDiagnostic({
    code: ANALYSIS_DIAGNOSTIC_CODES.REQUIRED_TOOL_MISSING,
    severity: 'error',
    message: 'objdump is missing',
    toolchainId: 'gnu-arm-none-eabi',
  });
}

function partialDiagnostic(): AnalysisDiagnostic {
  return createAnalysisDiagnostic({
    code: ANALYSIS_DIAGNOSTIC_CODES.ANALYSIS_PARTIAL,
    severity: 'warning',
    message: 'symbol details are incomplete',
    toolchainId: 'gnu-arm-none-eabi',
  });
}

function artifactsFor(fixture: ToolchainFixture): BuildArtifactSet {
  return {
    mapPath: fixture.inputPaths.map,
    executablePath: '/synthetic/not-read-by-this-test.elf',
    linkerScriptPaths: [],
  };
}

function requiredFixture(id: string): ToolchainFixture {
  const fixture = loadToolchainFixtures().find(candidate =>
    candidate.manifest.id === id
  );
  assert.ok(fixture, `Missing fixture ${id}`);
  return fixture;
}
