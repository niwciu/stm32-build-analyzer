import * as assert from 'assert';
import type { BuildArtifactSet } from '../artifacts/BuildArtifactSet';
import {
  AnalyzedMemoryRegion,
  BuildAnalysis,
  BuildAnalysisResult,
  ToolchainAdapter,
  ToolchainDetection,
  ToolchainDetector,
} from '../analysis/contracts';
import {
  ANALYSIS_DIAGNOSTIC_CODES,
  createAnalysisDiagnostic,
} from '../analysis/diagnostics';

suite('analysis contracts', () => {
  const artifacts: BuildArtifactSet = {
    executablePath: '/workspace/build/firmware.elf',
    mapPath: '/workspace/build/firmware.map',
    linkerScriptPaths: [],
    workspaceFolder: '/workspace',
  };

  const detection: ToolchainDetection = {
    toolchainId: 'gnu-arm-none-eabi',
    confidence: 0.9,
    evidence: [{
      source: 'file-content',
      description: 'GNU linker Memory Configuration marker',
      weight: 0.9,
    }],
    diagnostics: [],
  };

  const analysis: BuildAnalysis = {
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
    warnings: [],
  };

  test('exposes stable and unique diagnostic codes', () => {
    assert.deepStrictEqual(Object.values(ANALYSIS_DIAGNOSTIC_CODES), [
      'ARTIFACT_MISSING',
      'ARTIFACT_UNREADABLE',
      'TOOLCHAIN_UNKNOWN',
      'TOOLCHAIN_AMBIGUOUS',
      'TOOLCHAIN_UNSUPPORTED',
      'REQUIRED_TOOL_MISSING',
      'MAP_FORMAT_UNSUPPORTED',
      'TOOL_EXECUTION_FAILED',
      'ANALYSIS_PARTIAL',
      'ANALYSIS_CANCELLED',
    ]);
    assert.strictEqual(
      new Set(Object.values(ANALYSIS_DIAGNOSTIC_CODES)).size,
      Object.values(ANALYSIS_DIAGNOSTIC_CODES).length
    );
  });

  test('normalizes Error causes into serializable diagnostic data', () => {
    const cause = Object.assign(new Error('spawn failed'), { code: 'ENOENT' });
    const diagnostic = createAnalysisDiagnostic({
      code: ANALYSIS_DIAGNOSTIC_CODES.TOOL_EXECUTION_FAILED,
      severity: 'error',
      message: 'Could not inspect the executable.',
      toolchainId: 'gnu-arm-none-eabi',
      artifactPath: artifacts.executablePath,
      cause,
      remediation: 'Install arm-none-eabi-objdump.',
    });

    assert.deepStrictEqual(diagnostic.cause, {
      name: 'Error',
      message: 'spawn failed',
      code: 'ENOENT',
    });
    assert.ok(!(diagnostic.cause instanceof Error));
  });

  test('normalizes non-Error causes without throwing', () => {
    const diagnostic = createAnalysisDiagnostic({
      code: ANALYSIS_DIAGNOSTIC_CODES.ARTIFACT_UNREADABLE,
      severity: 'error',
      message: 'Could not read the MAP file.',
      cause: 'permission denied',
    });

    assert.deepStrictEqual(diagnostic.cause, { message: 'permission denied' });
  });

  test('represents unknown numeric values with null and preserves known zero', () => {
    const regions: readonly AnalyzedMemoryRegion[] = [{
      name: 'RAM',
      startAddress: 0x20000000,
      size: 0x20000,
      used: null,
      sections: [{
        name: '.bss',
        startAddress: 0x20000000,
        size: 0,
        loadAddress: null,
        symbols: [{
          name: 'unknown_size',
          startAddress: 0x20000000,
          size: null,
          source: {
            path: '/workspace/src/main.c',
            line: null,
            column: null,
          },
        }],
      }],
    }];

    assert.strictEqual(regions[0].used, null);
    assert.strictEqual(regions[0].sections[0].size, 0);
    assert.strictEqual(regions[0].sections[0].symbols[0].size, null);
  });

  test('covers every analysis result status exhaustively', () => {
    const results: BuildAnalysisResult[] = [
      { status: 'success', detection, analysis, diagnostics: [] },
      { status: 'partial', detection, analysis, diagnostics: [] },
      { status: 'unsupported', detection, diagnostics: [] },
      { status: 'unknown', detections: [], diagnostics: [] },
      { status: 'ambiguous', detections: [detection], diagnostics: [] },
      { status: 'invalid', diagnostics: [] },
      { status: 'cancelled', diagnostics: [] },
    ];

    assert.deepStrictEqual(results.map(resultStatus), [
      'success',
      'partial',
      'unsupported',
      'unknown',
      'ambiguous',
      'invalid',
      'cancelled',
    ]);
  });

  test('supports injectable detector and adapter contracts', async () => {
    const detector: ToolchainDetector = {
      toolchainId: 'gnu-arm-none-eabi',
      detect: async received => received === artifacts ? detection : null,
    };
    const adapter: ToolchainAdapter = {
      toolchainId: 'gnu-arm-none-eabi',
      validateEnvironment: async () => ({
        status: 'valid',
        tools: [],
        diagnostics: [],
      }),
      analyze: async () => analysis,
    };

    assert.strictEqual(await detector.detect(artifacts), detection);
    assert.strictEqual((await adapter.validateEnvironment(artifacts)).status, 'valid');
    assert.strictEqual(await adapter.analyze(artifacts), analysis);
  });
});

function resultStatus(result: BuildAnalysisResult): string {
  switch (result.status) {
    case 'success':
    case 'partial':
    case 'unsupported':
    case 'unknown':
    case 'ambiguous':
    case 'invalid':
    case 'cancelled':
      return result.status;
    default:
      return assertNever(result);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled analysis result: ${JSON.stringify(value)}`);
}
