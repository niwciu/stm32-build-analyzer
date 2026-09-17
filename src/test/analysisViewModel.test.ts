import * as assert from 'assert';
import type {
  BuildAnalysis,
  ToolchainDetection,
} from '../analysis/contracts';
import {
  ANALYSIS_DIAGNOSTIC_CODES,
  createAnalysisDiagnostic,
} from '../analysis/diagnostics';
import { toAnalysisViewModel } from '../presentation/analysisViewModel';

const gnuDetection = detection('gnu-arm-none-eabi', 0.9);

suite('analysis view-model mapping', () => {
  test('maps common GNU analysis back to the existing webview model', () => {
    const viewModel = toAnalysisViewModel({
      status: 'success',
      detection: gnuDetection,
      analysis: analysis(),
      diagnostics: [],
    });

    assert.strictEqual(viewModel.kind, 'data');
    assert.strictEqual(viewModel.toolchainName, 'GNU Arm Embedded');
    assert.deepStrictEqual(viewModel.regions, [{
      name: 'FLASH',
      startAddress: 0x08000000,
      size: 0x1000,
      used: 0,
      sections: [{
        name: '.text',
        startAddress: 0x08000000,
        size: 16,
        loadAddress: 0,
        symbols: [{
          name: 'main',
          startAddress: 0x08000000,
          size: 0,
          path: '/workspace/main.c',
          row: 7,
        }],
      }],
    }]);
  });

  test('renders partial diagnostics with remediation while retaining data', () => {
    const diagnostic = createAnalysisDiagnostic({
      code: ANALYSIS_DIAGNOSTIC_CODES.ANALYSIS_PARTIAL,
      severity: 'warning',
      message: 'Symbol details are incomplete.',
      remediation: 'Install arm-none-eabi-nm.',
    });
    const viewModel = toAnalysisViewModel({
      status: 'partial',
      detection: gnuDetection,
      analysis: analysis([diagnostic]),
      diagnostics: [diagnostic],
    });

    assert.strictEqual(viewModel.kind, 'data');
    assert.deepStrictEqual(viewModel.warnings, [
      'Symbol details are incomplete.\nRemediation: Install arm-none-eabi-nm.',
    ]);
  });

  test('renders a named unsupported toolchain as a warning', () => {
    const viewModel = toAnalysisViewModel({
      status: 'unsupported',
      detection: detection('iar-arm', 1),
      diagnostics: [],
    });

    assert.deepStrictEqual(viewModel, {
      kind: 'status',
      status: 'unsupported',
      title: 'Unsupported toolchain: IAR Embedded Workbench for Arm',
      message: 'This toolchain is recognized, but an analysis adapter is not available.',
      level: 'warning',
    });
  });

  test('renders unknown and ambiguous detection without data', () => {
    const unknown = toAnalysisViewModel({
      status: 'unknown',
      detections: [],
      diagnostics: [],
    });
    const ambiguous = toAnalysisViewModel({
      status: 'ambiguous',
      detections: [
        detection('gnu-arm-none-eabi', 0.9),
        detection('iar-arm', 0.85),
      ],
      diagnostics: [],
    });

    assert.strictEqual(unknown.kind, 'status');
    assert.strictEqual(unknown.title, 'Toolchain not recognized');
    assert.strictEqual(ambiguous.kind, 'status');
    assert.match(ambiguous.message, /GNU Arm Embedded \(90%\)/);
    assert.match(ambiguous.message, /IAR Embedded Workbench for Arm \(85%\)/);
  });

  test('distinguishes missing tools from other invalid states', () => {
    const missingTool = toAnalysisViewModel({
      status: 'invalid',
      diagnostics: [createAnalysisDiagnostic({
        code: ANALYSIS_DIAGNOSTIC_CODES.REQUIRED_TOOL_MISSING,
        severity: 'error',
        message: 'objdump is missing',
      })],
    });
    const invalidArtifact = toAnalysisViewModel({
      status: 'invalid',
      diagnostics: [createAnalysisDiagnostic({
        code: ANALYSIS_DIAGNOSTIC_CODES.ARTIFACT_UNREADABLE,
        severity: 'error',
        message: 'MAP file is unreadable',
      })],
    });

    assert.strictEqual(missingTool.kind, 'status');
    assert.strictEqual(missingTool.title, 'Required analysis tool is missing');
    assert.strictEqual(invalidArtifact.kind, 'status');
    assert.strictEqual(invalidArtifact.title, 'Build analysis unavailable');
  });

  test('renders cancellation as informational status', () => {
    const viewModel = toAnalysisViewModel({
      status: 'cancelled',
      diagnostics: [],
    });

    assert.deepStrictEqual(viewModel, {
      kind: 'status',
      status: 'cancelled',
      title: 'Build analysis cancelled',
      message: 'Refresh the analysis to try again.',
      level: 'info',
    });
  });
});

function detection(
  toolchainId: ToolchainDetection['toolchainId'],
  confidence: number
): ToolchainDetection {
  return {
    toolchainId,
    confidence,
    evidence: [],
    diagnostics: [],
  };
}

function analysis(
  warnings: BuildAnalysis['warnings'] = []
): BuildAnalysis {
  const result: BuildAnalysis = {
    regions: [{
      name: 'FLASH',
      startAddress: 0x08000000,
      size: 0x1000,
      used: null,
      sections: [{
        name: '.text',
        startAddress: 0x08000000,
        size: 16,
        loadAddress: null,
        symbols: [{
          name: 'main',
          startAddress: 0x08000000,
          size: null,
          source: {
            path: '/workspace/main.c',
            line: 7,
            column: null,
          },
        }],
      }],
    }],
    toolchain: {
      id: 'gnu-arm-none-eabi',
      displayName: 'GNU Arm Embedded',
    },
    provenance: {
      adapterId: 'gnu-arm-none-eabi',
      artifacts: { linkerScriptPaths: [] },
      toolInvocations: [],
      notes: [],
    },
    warnings,
  };
  return result;
}
