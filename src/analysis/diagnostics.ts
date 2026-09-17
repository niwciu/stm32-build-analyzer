import type { ToolchainId } from './contracts';

export const ANALYSIS_DIAGNOSTIC_CODES = {
  ARTIFACT_MISSING: 'ARTIFACT_MISSING',
  ARTIFACT_UNREADABLE: 'ARTIFACT_UNREADABLE',
  TOOLCHAIN_UNKNOWN: 'TOOLCHAIN_UNKNOWN',
  TOOLCHAIN_AMBIGUOUS: 'TOOLCHAIN_AMBIGUOUS',
  TOOLCHAIN_UNSUPPORTED: 'TOOLCHAIN_UNSUPPORTED',
  REQUIRED_TOOL_MISSING: 'REQUIRED_TOOL_MISSING',
  MAP_FORMAT_UNSUPPORTED: 'MAP_FORMAT_UNSUPPORTED',
  TOOL_EXECUTION_FAILED: 'TOOL_EXECUTION_FAILED',
  ANALYSIS_PARTIAL: 'ANALYSIS_PARTIAL',
  ANALYSIS_CANCELLED: 'ANALYSIS_CANCELLED',
} as const;

export type AnalysisDiagnosticCode =
  typeof ANALYSIS_DIAGNOSTIC_CODES[keyof typeof ANALYSIS_DIAGNOSTIC_CODES];

export type AnalysisDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface AnalysisDiagnosticCause {
  readonly name?: string;
  readonly message: string;
  readonly code?: string;
}

export interface AnalysisDiagnostic {
  readonly code: AnalysisDiagnosticCode;
  readonly severity: AnalysisDiagnosticSeverity;
  readonly message: string;
  readonly toolchainId?: ToolchainId;
  readonly artifactPath?: string;
  readonly cause?: AnalysisDiagnosticCause;
  readonly remediation?: string;
}

export interface AnalysisDiagnosticInit {
  readonly code: AnalysisDiagnosticCode;
  readonly severity: AnalysisDiagnosticSeverity;
  readonly message: string;
  readonly toolchainId?: ToolchainId;
  readonly artifactPath?: string;
  readonly cause?: unknown;
  readonly remediation?: string;
}

/** Creates a serializable diagnostic without retaining an Error instance. */
export function createAnalysisDiagnostic(
  init: AnalysisDiagnosticInit
): AnalysisDiagnostic {
  const cause = init.cause === undefined
    ? undefined
    : normalizeDiagnosticCause(init.cause);

  return {
    code: init.code,
    severity: init.severity,
    message: init.message,
    toolchainId: init.toolchainId,
    artifactPath: init.artifactPath,
    cause,
    remediation: init.remediation,
  };
}

function normalizeDiagnosticCause(cause: unknown): AnalysisDiagnosticCause {
  if (cause instanceof Error) {
    const errorCode = (cause as NodeJS.ErrnoException).code;
    return {
      name: cause.name,
      message: cause.message,
      code: errorCode,
    };
  }

  return { message: String(cause) };
}
