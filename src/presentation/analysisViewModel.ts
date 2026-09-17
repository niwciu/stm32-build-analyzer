import type {
  AnalyzedMemoryRegion,
  BuildAnalysisResult,
  KnownToolchainId,
  ToolchainDetection,
} from '../analysis/contracts';
import { getToolchainDisplayName } from '../analysis/AnalysisOrchestrator';
import {
  ANALYSIS_DIAGNOSTIC_CODES,
  AnalysisDiagnostic,
} from '../analysis/diagnostics';
import type { Region } from '../models';

export type AnalysisStatusLevel = 'info' | 'warning' | 'error';

export interface AnalysisDataViewModel {
  readonly kind: 'data';
  readonly status: 'success' | 'partial';
  readonly regions: Region[];
  readonly warnings: readonly string[];
  readonly toolchainName: string;
}

export interface AnalysisStatusViewModel {
  readonly kind: 'status';
  readonly status: Exclude<BuildAnalysisResult['status'], 'success' | 'partial'>;
  readonly title: string;
  readonly message: string;
  readonly level: AnalysisStatusLevel;
}

export type AnalysisViewModel = AnalysisDataViewModel | AnalysisStatusViewModel;

export function toAnalysisViewModel(
  result: BuildAnalysisResult
): AnalysisViewModel {
  switch (result.status) {
    case 'success':
    case 'partial':
      return {
        kind: 'data',
        status: result.status,
        regions: result.analysis.regions.map(toLegacyRegion),
        warnings: result.diagnostics
          .filter(diagnostic => diagnostic.severity !== 'info')
          .map(formatDiagnostic),
        toolchainName: result.analysis.toolchain.displayName,
      };
    case 'unsupported':
      return statusViewModel(
        result.status,
        `Unsupported toolchain: ${detectionName(result.detection)}`,
        result.diagnostics,
        'warning',
        'This toolchain is recognized, but an analysis adapter is not available.'
      );
    case 'unknown':
      return statusViewModel(
        result.status,
        'Toolchain not recognized',
        result.diagnostics,
        'warning',
        'The selected artifacts do not contain enough evidence to identify their toolchain.'
      );
    case 'ambiguous':
      return statusViewModel(
        result.status,
        'Toolchain detection is ambiguous',
        result.diagnostics,
        'warning',
        ambiguityFallback(result.detections)
      );
    case 'invalid': {
      const missingTool = result.diagnostics.some(diagnostic =>
        diagnostic.code === ANALYSIS_DIAGNOSTIC_CODES.REQUIRED_TOOL_MISSING
      );
      return statusViewModel(
        result.status,
        missingTool ? 'Required analysis tool is missing' : 'Build analysis unavailable',
        result.diagnostics,
        'error',
        'The selected build artifacts or analysis environment are invalid.'
      );
    }
    case 'cancelled':
      return statusViewModel(
        result.status,
        'Build analysis cancelled',
        result.diagnostics,
        'info',
        'Refresh the analysis to try again.'
      );
    default:
      return assertNever(result);
  }
}

function statusViewModel(
  status: AnalysisStatusViewModel['status'],
  title: string,
  diagnostics: readonly AnalysisDiagnostic[],
  level: AnalysisStatusLevel,
  fallback: string
): AnalysisStatusViewModel {
  return {
    kind: 'status',
    status,
    title,
    message: diagnostics.length > 0
      ? diagnostics.map(formatDiagnostic).join('\n\n')
      : fallback,
    level,
  };
}

function formatDiagnostic(diagnostic: AnalysisDiagnostic): string {
  return diagnostic.remediation
    ? `${diagnostic.message}\nRemediation: ${diagnostic.remediation}`
    : diagnostic.message;
}

function detectionName(detection: ToolchainDetection): string {
  return detection.toolchainId === 'unknown'
    ? 'Unknown'
    : getToolchainDisplayName(detection.toolchainId);
}

function ambiguityFallback(detections: readonly ToolchainDetection[]): string {
  const candidates = detections
    .filter((detection): detection is ToolchainDetection & {
      readonly toolchainId: KnownToolchainId;
    } => detection.toolchainId !== 'unknown')
    .slice(0, 2)
    .map(detection =>
      `${getToolchainDisplayName(detection.toolchainId)} (${Math.round(detection.confidence * 100)}%)`
    );
  return candidates.length > 0
    ? `Conflicting evidence matched ${candidates.join(' and ')}.`
    : 'Conflicting evidence matched more than one toolchain.';
}

function toLegacyRegion(region: AnalyzedMemoryRegion): Region {
  return {
    name: region.name,
    startAddress: region.startAddress,
    size: region.size,
    used: region.used ?? 0,
    sections: region.sections.map(section => ({
      name: section.name,
      startAddress: section.startAddress,
      size: section.size,
      loadAddress: section.loadAddress ?? 0,
      symbols: section.symbols.map(symbol => ({
        name: symbol.name,
        startAddress: symbol.startAddress,
        size: symbol.size ?? 0,
        path: symbol.source?.path ?? '',
        row: symbol.source?.line ?? 0,
      })),
    })),
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled analysis result: ${JSON.stringify(value)}`);
}
