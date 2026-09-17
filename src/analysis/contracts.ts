import type { BuildArtifactSet } from '../artifacts/BuildArtifactSet';
import type { AnalysisDiagnostic } from './diagnostics';

export type ToolchainId =
  | 'gnu-arm-none-eabi'
  | 'gnu-riscv-none-elf'
  | 'gnu-xtensa-elf'
  | 'llvm'
  | 'keil-armclang'
  | 'iar-arm'
  | 'unknown';

export type KnownToolchainId = Exclude<ToolchainId, 'unknown'>;

export type DetectionEvidenceSource =
  | 'file-content'
  | 'elf-metadata'
  | 'file-name'
  | 'configured-tool'
  | 'available-tool';

export interface DetectionEvidence {
  readonly source: DetectionEvidenceSource;
  readonly description: string;
  readonly weight: number;
}

export interface ToolchainDetection {
  readonly toolchainId: ToolchainId;
  /** Normalized confidence from 0 (no confidence) to 1 (certain). */
  readonly confidence: number;
  readonly evidence: readonly DetectionEvidence[];
  readonly diagnostics: readonly AnalysisDiagnostic[];
}

export interface ToolchainDetector {
  readonly toolchainId: ToolchainId;
  detect(
    artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<ToolchainDetection | null>;
}

export type EnvironmentValidationStatus = 'valid' | 'partial' | 'invalid';

export interface EnvironmentTool {
  readonly name: string;
  readonly role: string;
  readonly required: boolean;
  readonly resolvedPath?: string;
  readonly version?: string;
}

export interface EnvironmentValidation {
  readonly status: EnvironmentValidationStatus;
  readonly tools: readonly EnvironmentTool[];
  readonly diagnostics: readonly AnalysisDiagnostic[];
}

export interface SourceLocation {
  readonly path: string;
  /** One-based source line, or null when debug information has no line. */
  readonly line: number | null;
  /** One-based source column, or null when unavailable. */
  readonly column: number | null;
}

export interface AnalyzedSymbol {
  readonly name: string;
  readonly startAddress: number;
  /** Symbol extent in bytes, or null when the tool did not report a size. */
  readonly size: number | null;
  readonly source?: SourceLocation;
}

export interface AnalyzedSection {
  readonly name: string;
  readonly startAddress: number;
  /** Runtime extent in bytes. */
  readonly size: number;
  /** Load image address, or null when no load address is known. */
  readonly loadAddress: number | null;
  readonly symbols: readonly AnalyzedSymbol[];
}

export interface AnalyzedMemoryRegion {
  readonly name: string;
  readonly startAddress: number;
  /** Region capacity in bytes. */
  readonly size: number;
  /** Accounted bytes, or null when usage could not be calculated. */
  readonly used: number | null;
  readonly sections: readonly AnalyzedSection[];
}

export interface ToolchainMetadata {
  readonly id: KnownToolchainId;
  readonly displayName: string;
  readonly version?: string;
  readonly targetArchitecture?: string;
}

export interface ToolInvocationProvenance {
  readonly tool: string;
  readonly executablePath: string;
  readonly arguments: readonly string[];
  readonly version?: string;
}

export interface AnalysisProvenance {
  readonly adapterId: KnownToolchainId;
  readonly artifacts: BuildArtifactSet;
  readonly toolInvocations: readonly ToolInvocationProvenance[];
  readonly notes: readonly string[];
}

export interface BuildAnalysis {
  readonly regions: readonly AnalyzedMemoryRegion[];
  readonly toolchain: ToolchainMetadata;
  readonly provenance: AnalysisProvenance;
  readonly warnings: readonly AnalysisDiagnostic[];
}

export interface ToolchainAdapter {
  readonly toolchainId: KnownToolchainId;
  validateEnvironment(
    artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<EnvironmentValidation>;
  analyze(
    artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<BuildAnalysis>;
}

export type BuildAnalysisResult =
  | {
    readonly status: 'success';
    readonly detection: ToolchainDetection;
    readonly analysis: BuildAnalysis;
    readonly diagnostics: readonly AnalysisDiagnostic[];
  }
  | {
    readonly status: 'partial';
    readonly detection: ToolchainDetection;
    readonly analysis: BuildAnalysis;
    readonly diagnostics: readonly AnalysisDiagnostic[];
  }
  | {
    readonly status: 'unsupported';
    readonly detection: ToolchainDetection;
    readonly diagnostics: readonly AnalysisDiagnostic[];
  }
  | {
    readonly status: 'unknown';
    readonly detections: readonly ToolchainDetection[];
    readonly diagnostics: readonly AnalysisDiagnostic[];
  }
  | {
    readonly status: 'ambiguous';
    readonly detections: readonly ToolchainDetection[];
    readonly diagnostics: readonly AnalysisDiagnostic[];
  }
  | {
    readonly status: 'invalid';
    readonly diagnostics: readonly AnalysisDiagnostic[];
  }
  | {
    readonly status: 'cancelled';
    readonly diagnostics: readonly AnalysisDiagnostic[];
  };
