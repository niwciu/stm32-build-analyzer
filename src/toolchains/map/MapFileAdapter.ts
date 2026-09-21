import * as fs from 'fs';
import type { BuildArtifactSet } from '../../artifacts/BuildArtifactSet';
import type {
  AnalyzedMemoryRegion,
  BuildAnalysis,
  EnvironmentValidation,
  KnownToolchainId,
  ToolchainAdapter,
} from '../../analysis/contracts';
import {
  ANALYSIS_DIAGNOSTIC_CODES,
  AnalysisDiagnostic,
  createAnalysisDiagnostic,
} from '../../analysis/diagnostics';
import { AnalysisCancelledError } from '../../utils/errors';

export interface ParsedMapAnalysis {
  readonly regions: readonly AnalyzedMemoryRegion[];
  readonly version?: string;
  readonly warnings?: readonly AnalysisDiagnostic[];
  readonly notes?: readonly string[];
}

export interface MapAnalysisParser {
  parseFile(mapPath: string): ParsedMapAnalysis;
}

export interface MapFileAdapterDefinition {
  readonly displayName: string;
  readonly targetArchitecture: string;
  readonly parser: MapAnalysisParser;
}

/** Adapter workflow for proprietary toolchains whose text MAP is self-contained. */
export abstract class MapFileAdapter implements ToolchainAdapter {
  abstract readonly toolchainId: KnownToolchainId;
  protected abstract readonly definition: MapFileAdapterDefinition;

  async validateEnvironment(
    _artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<EnvironmentValidation> {
    throwIfCancelled(signal);
    return { status: 'valid', tools: [], diagnostics: [] };
  }

  async analyze(
    artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<BuildAnalysis> {
    throwIfCancelled(signal);
    if (!artifacts.mapPath) {
      throw mapFormatError(
        this.toolchainId,
        undefined,
        `${this.definition.displayName} analysis requires a MAP artifact.`
      );
    }

    const parsed = this.definition.parser.parseFile(artifacts.mapPath);
    throwIfCancelled(signal);
    return {
      regions: parsed.regions,
      toolchain: {
        id: this.toolchainId,
        displayName: this.definition.displayName,
        version: parsed.version,
        targetArchitecture: this.definition.targetArchitecture,
      },
      provenance: {
        adapterId: this.toolchainId,
        artifacts,
        toolInvocations: [],
        notes: [
          'Analysis used the linker MAP file; no proprietary executable was invoked.',
          ...(parsed.notes ?? []),
        ],
      },
      warnings: parsed.warnings ?? [],
    };
  }
}

export class MapFormatError extends Error {
  constructor(
    message: string,
    public readonly diagnostic: AnalysisDiagnostic
  ) {
    super(message);
    this.name = 'MapFormatError';
  }
}

export function readMapText(
  toolchainId: KnownToolchainId,
  mapPath: string
): string {
  try {
    return fs.readFileSync(mapPath, 'utf8');
  } catch (cause) {
    throw mapFormatError(
      toolchainId,
      mapPath,
      `Cannot read linker MAP file "${mapPath}".`,
      cause
    );
  }
}

export function mapFormatError(
  toolchainId: KnownToolchainId,
  artifactPath: string | undefined,
  message: string,
  cause?: unknown
): MapFormatError {
  const fullMessage = `Embedded Build Analyzer: ${message}`;
  return new MapFormatError(fullMessage, createAnalysisDiagnostic({
    code: ANALYSIS_DIAGNOSTIC_CODES.MAP_FORMAT_UNSUPPORTED,
    severity: 'error',
    message: fullMessage,
    toolchainId,
    artifactPath,
    cause,
    remediation: 'Generate a full linker MAP using a documented supported format.',
  }));
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AnalysisCancelledError();
  }
}
