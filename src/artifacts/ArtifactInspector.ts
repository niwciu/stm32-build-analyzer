import * as fs from 'fs';
import { ANALYSIS_DIAGNOSTIC_CODES, AnalysisDiagnostic, createAnalysisDiagnostic } from '../analysis/diagnostics';
import { AnalysisCancelledError } from '../utils/errors';

export interface ArtifactInspector {
  readText(artifactPath: string, signal?: AbortSignal): Promise<string>;
  readBytes(
    artifactPath: string,
    maximumBytes: number,
    signal?: AbortSignal
  ): Promise<Buffer>;
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

  async readBytes(
    artifactPath: string,
    maximumBytes: number,
    signal?: AbortSignal
  ): Promise<Buffer> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw new Error('maximumBytes must be a positive safe integer.');
    }
    if (signal?.aborted) {
      throw new AnalysisCancelledError();
    }

    let handle: fs.promises.FileHandle | undefined;
    try {
      handle = await fs.promises.open(artifactPath, 'r');
      const buffer = Buffer.alloc(maximumBytes);
      const { bytesRead } = await handle.read(buffer, 0, maximumBytes, 0);
      if (signal?.aborted) {
        throw new AnalysisCancelledError();
      }
      return buffer.subarray(0, bytesRead);
    } catch (error) {
      if (error instanceof AnalysisCancelledError
        || signal?.aborted
        || isAbortError(error)) {
        throw new AnalysisCancelledError();
      }
      throw artifactInspectionError(artifactPath, error);
    } finally {
      await handle?.close();
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function artifactInspectionError(
  artifactPath: string,
  cause: unknown
): ArtifactInspectionError {
  const diagnostic = createAnalysisDiagnostic({
    code: ANALYSIS_DIAGNOSTIC_CODES.ARTIFACT_UNREADABLE,
    severity: 'error',
    message: `Could not inspect build artifact "${artifactPath}".`,
    artifactPath,
    cause,
    remediation: 'Verify that the artifact exists and is readable.',
  });
  return new ArtifactInspectionError(diagnostic.message, diagnostic);
}
