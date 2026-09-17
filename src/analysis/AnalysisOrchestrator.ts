import type { BuildArtifactSet } from '../artifacts/BuildArtifactSet';
import {
  BuildArtifactValidator,
  FileSystemBuildArtifactValidator,
} from '../artifacts/BuildArtifactValidator';
import { AnalysisCancelledError } from '../utils/errors';
import type { DetectorDependencies } from '../toolchains/detection/EvidenceBasedDetector';
import type { GnuArmAdapterDependencies } from '../toolchains/gnu-arm/GnuArmAdapter';
import {
  AdapterRegistry,
  createDefaultAdapterRegistry,
} from './AdapterRegistry';
import type {
  BuildAnalysisResult,
  KnownToolchainId,
} from './contracts';
import {
  createDefaultDetectionRegistry,
  DetectionRegistryOptions,
  DetectionReport,
} from './DetectionRegistry';
import {
  ANALYSIS_DIAGNOSTIC_CODES,
  AnalysisDiagnostic,
  createAnalysisDiagnostic,
} from './diagnostics';

export interface ToolchainDetectionService {
  detect(
    artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<DetectionReport>;
}

export interface AnalysisOrchestratorDependencies {
  readonly artifactValidator?: BuildArtifactValidator;
}

export interface DefaultAnalysisOrchestratorOptions {
  readonly toolchainPath: string;
  readonly debug?: boolean;
  readonly detectorDependencies?: DetectorDependencies;
  readonly detectionOptions?: DetectionRegistryOptions;
  readonly adapterDependencies?: GnuArmAdapterDependencies;
  readonly artifactValidator?: BuildArtifactValidator;
}

const TOOLCHAIN_DISPLAY_NAMES: Readonly<Record<KnownToolchainId, string>> = {
  'gnu-arm-none-eabi': 'GNU Arm Embedded',
  'gnu-riscv-none-elf': 'GNU RISC-V Embedded',
  'gnu-xtensa-elf': 'GNU Xtensa Embedded',
  llvm: 'LLVM/Clang',
  'keil-armclang': 'Keil/Arm Compiler',
  'iar-arm': 'IAR Embedded Workbench for Arm',
};

export class AnalysisOrchestrator {
  private readonly artifactValidator: BuildArtifactValidator;

  constructor(
    private readonly detectionService: ToolchainDetectionService,
    private readonly adapterRegistry: AdapterRegistry,
    dependencies: AnalysisOrchestratorDependencies = {}
  ) {
    this.artifactValidator = dependencies.artifactValidator
      ?? new FileSystemBuildArtifactValidator();
  }

  async analyze(
    artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<BuildAnalysisResult> {
    try {
      throwIfCancelled(signal);
      const artifactDiagnostics = await this.artifactValidator.validate(
        artifacts,
        signal
      );
      throwIfCancelled(signal);
      if (artifactDiagnostics.length > 0) {
        return { status: 'invalid', diagnostics: artifactDiagnostics };
      }

      const report = await this.detectionService.detect(artifacts, signal);
      throwIfCancelled(signal);
      if (report.status !== 'detected') {
        return {
          status: report.status,
          detections: report.detections,
          diagnostics: report.diagnostics,
        };
      }

      const detection = report.detection;
      if (detection.toolchainId === 'unknown') {
        return {
          status: 'unknown',
          detections: report.detections,
          diagnostics: [
            ...report.diagnostics,
            createAnalysisDiagnostic({
              code: ANALYSIS_DIAGNOSTIC_CODES.TOOLCHAIN_UNKNOWN,
              severity: 'warning',
              message: 'The selected detector returned an unknown toolchain.',
              remediation: 'Provide artifacts containing an identifiable linker producer.',
            }),
          ],
        };
      }

      const adapter = this.adapterRegistry.get(detection.toolchainId);
      if (!adapter) {
        return {
          status: 'unsupported',
          detection,
          diagnostics: [
            ...report.diagnostics,
            unsupportedDiagnostic(detection.toolchainId),
          ],
        };
      }

      const environment = await adapter.validateEnvironment(artifacts, signal);
      throwIfCancelled(signal);
      if (environment.status === 'invalid') {
        const environmentDiagnostics = environment.diagnostics.length > 0
          ? environment.diagnostics
          : [createAnalysisDiagnostic({
            code: ANALYSIS_DIAGNOSTIC_CODES.REQUIRED_TOOL_MISSING,
            severity: 'error',
            message: `Required ${getToolchainDisplayName(detection.toolchainId)} analysis tools are unavailable.`,
            toolchainId: detection.toolchainId,
            remediation: 'Install the required toolchain or correct its configured path.',
          })];
        return {
          status: 'invalid',
          diagnostics: uniqueDiagnostics([
            ...report.diagnostics,
            ...environmentDiagnostics,
          ]),
        };
      }

      const analysis = await adapter.analyze(artifacts, signal);
      throwIfCancelled(signal);
      const diagnostics = uniqueDiagnostics([
        ...report.diagnostics,
        ...environment.diagnostics,
        ...analysis.warnings,
      ]);
      const status = environment.status === 'partial'
        || analysis.warnings.length > 0
        ? 'partial'
        : 'success';

      return { status, detection, analysis, diagnostics };
    } catch (error) {
      if (error instanceof AnalysisCancelledError || signal?.aborted) {
        return cancelledResult();
      }

      return {
        status: 'invalid',
        diagnostics: [diagnosticFromFailure(error)],
      };
    }
  }
}

export function createDefaultAnalysisOrchestrator(
  options: DefaultAnalysisOrchestratorOptions
): AnalysisOrchestrator {
  return new AnalysisOrchestrator(
    createDefaultDetectionRegistry(
      options.detectorDependencies,
      options.detectionOptions
    ),
    createDefaultAdapterRegistry(
      options.toolchainPath,
      options.debug,
      options.adapterDependencies
    ),
    { artifactValidator: options.artifactValidator }
  );
}

export function getToolchainDisplayName(
  toolchainId: KnownToolchainId
): string {
  return TOOLCHAIN_DISPLAY_NAMES[toolchainId];
}

function unsupportedDiagnostic(
  toolchainId: KnownToolchainId
): AnalysisDiagnostic {
  const displayName = getToolchainDisplayName(toolchainId);
  return createAnalysisDiagnostic({
    code: ANALYSIS_DIAGNOSTIC_CODES.TOOLCHAIN_UNSUPPORTED,
    severity: 'warning',
    message: `Detected ${displayName}, but analysis for this toolchain is not implemented yet. Existing build artifacts were not modified.`,
    toolchainId,
    remediation: `Use a GNU Arm Embedded build for analysis or wait for a ${displayName} adapter.`,
  });
}

function cancelledResult(): BuildAnalysisResult {
  return {
    status: 'cancelled',
    diagnostics: [createAnalysisDiagnostic({
      code: ANALYSIS_DIAGNOSTIC_CODES.ANALYSIS_CANCELLED,
      severity: 'info',
      message: 'Build analysis was cancelled.',
      remediation: 'Refresh the analysis to try again.',
    })],
  };
}

function diagnosticFromFailure(error: unknown): AnalysisDiagnostic {
  if (hasDiagnostic(error)) {
    return error.diagnostic;
  }

  return createAnalysisDiagnostic({
    code: ANALYSIS_DIAGNOSTIC_CODES.TOOL_EXECUTION_FAILED,
    severity: 'error',
    message: 'Toolchain analysis failed unexpectedly.',
    cause: error,
    remediation: 'Review the selected build artifacts and configured toolchain.',
  });
}

function hasDiagnostic(
  value: unknown
): value is { readonly diagnostic: AnalysisDiagnostic } {
  return typeof value === 'object'
    && value !== null
    && 'diagnostic' in value
    && typeof value.diagnostic === 'object'
    && value.diagnostic !== null;
}

function uniqueDiagnostics(
  diagnostics: readonly AnalysisDiagnostic[]
): AnalysisDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter(diagnostic => {
    const key = [
      diagnostic.code,
      diagnostic.toolchainId,
      diagnostic.artifactPath,
      diagnostic.message,
    ].join('\0');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AnalysisCancelledError();
  }
}
