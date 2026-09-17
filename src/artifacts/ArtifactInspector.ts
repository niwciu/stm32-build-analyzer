import * as fs from 'fs';
import { ANALYSIS_DIAGNOSTIC_CODES, AnalysisDiagnostic, createAnalysisDiagnostic } from '../analysis/diagnostics';
import { AnalysisCancelledError } from '../utils/errors';

export interface ArtifactInspector {
  readText(artifactPath: string, signal?: AbortSignal): Promise<string>;
}

export class ArtifactInspectionError extends Error {
  constructor(
    message: string,
    public readonly diagnostic: AnalysisDiagnostic
  ) {
    super(message);
    this.name = 'ArtifactInspectionError';
  }
}

/** Reads artifact text without executing or modifying the artifact. */
export class FileArtifactInspector implements ArtifactInspector {
  async readText(artifactPath: string, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) {
      throw new AnalysisCancelledError();
    }

    try {
      return await fs.promises.readFile(artifactPath, {
        encoding: 'utf8',
        signal,
      });
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        throw new AnalysisCancelledError();
      }

      const diagnostic = createAnalysisDiagnostic({
        code: ANALYSIS_DIAGNOSTIC_CODES.ARTIFACT_UNREADABLE,
        severity: 'error',
        message: `Could not inspect build artifact "${artifactPath}".`,
        artifactPath,
        cause: error,
        remediation: 'Verify that the artifact exists and is readable.',
      });
      throw new ArtifactInspectionError(diagnostic.message, diagnostic);
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
