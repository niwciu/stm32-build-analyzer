import * as fs from 'fs';
import type { AnalysisDiagnostic } from '../analysis/diagnostics';
import {
  ANALYSIS_DIAGNOSTIC_CODES,
  createAnalysisDiagnostic,
} from '../analysis/diagnostics';
import { AnalysisCancelledError } from '../utils/errors';
import type { BuildArtifactSet } from './BuildArtifactSet';

export interface BuildArtifactValidator {
  validate(
    artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<readonly AnalysisDiagnostic[]>;
}

interface RequiredArtifact {
  readonly kind: string;
  readonly path?: string;
}

export class FileSystemBuildArtifactValidator implements BuildArtifactValidator {
  async validate(
    artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<readonly AnalysisDiagnostic[]> {
    throwIfCancelled(signal);
    const required: readonly RequiredArtifact[] = [
      { kind: 'MAP', path: artifacts.mapPath },
      { kind: 'executable', path: artifacts.executablePath },
    ];
    const diagnostics: AnalysisDiagnostic[] = [];

    for (const artifact of required) {
      throwIfCancelled(signal);
      if (!artifact.path) {
        diagnostics.push(createAnalysisDiagnostic({
          code: ANALYSIS_DIAGNOSTIC_CODES.ARTIFACT_MISSING,
          severity: 'error',
          message: `A ${artifact.kind} artifact is required for build analysis.`,
          remediation: `Select a build output containing both MAP and executable artifacts.`,
        }));
        continue;
      }

      try {
        const stats = await fs.promises.stat(artifact.path);
        if (!stats.isFile()) {
          diagnostics.push(unreadableDiagnostic(
            artifact.kind,
            artifact.path,
            new Error('Path is not a regular file.')
          ));
          continue;
        }
        await fs.promises.access(artifact.path, fs.constants.R_OK);
      } catch (error) {
        diagnostics.push(unreadableDiagnostic(
          artifact.kind,
          artifact.path,
          error
        ));
      }
    }

    throwIfCancelled(signal);
    return diagnostics;
  }
}

function unreadableDiagnostic(
  kind: string,
  artifactPath: string,
  cause: unknown
): AnalysisDiagnostic {
  return createAnalysisDiagnostic({
    code: ANALYSIS_DIAGNOSTIC_CODES.ARTIFACT_UNREADABLE,
    severity: 'error',
    message: `The ${kind} artifact is not a readable file: "${artifactPath}".`,
    artifactPath,
    cause,
    remediation: 'Rebuild the target or select a readable build output.',
  });
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AnalysisCancelledError();
  }
}
