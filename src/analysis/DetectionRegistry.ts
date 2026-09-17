import type { BuildArtifactSet } from '../artifacts/BuildArtifactSet';
import { ArtifactInspectionError } from '../artifacts/ArtifactInspector';
import type {
  ToolchainDetection,
  ToolchainDetector,
} from './contracts';
import {
  ANALYSIS_DIAGNOSTIC_CODES,
  AnalysisDiagnostic,
  createAnalysisDiagnostic,
} from './diagnostics';
import { AnalysisCancelledError } from '../utils/errors';
import type { DetectorDependencies } from '../toolchains/detection/EvidenceBasedDetector';
import { GnuArmDetector } from '../toolchains/gnu-arm/GnuArmDetector';
import { GnuRiscVDetector } from '../toolchains/known/GnuRiscVDetector';
import { GnuXtensaDetector } from '../toolchains/known/GnuXtensaDetector';
import { IarDetector } from '../toolchains/known/IarDetector';
import { KeilDetector } from '../toolchains/known/KeilDetector';
import { LlvmDetector } from '../toolchains/known/LlvmDetector';

export type DetectionReport =
  | {
    readonly status: 'detected';
    readonly detection: ToolchainDetection;
    readonly detections: readonly ToolchainDetection[];
    readonly diagnostics: readonly AnalysisDiagnostic[];
  }
  | {
    readonly status: 'unknown' | 'ambiguous';
    readonly detections: readonly ToolchainDetection[];
    readonly diagnostics: readonly AnalysisDiagnostic[];
  };

export interface DetectionRegistryOptions {
  /** Minimum confidence that can select a toolchain. */
  readonly minimumConfidence?: number;
  /** Maximum difference between two qualifying scores that is a tie. */
  readonly ambiguityDelta?: number;
  /** Receives deterministic evidence traces when debug logging is enabled. */
  readonly debugLogger?: (message: string) => void;
}

interface DetectorOutcome {
  readonly detectorId: string;
  readonly detection: ToolchainDetection | null;
  readonly diagnostic?: AnalysisDiagnostic;
}

const DEFAULT_MINIMUM_CONFIDENCE = 0.6;
const DEFAULT_AMBIGUITY_DELTA = 0.1;

export class DetectionRegistry {
  private readonly minimumConfidence: number;
  private readonly ambiguityDelta: number;
  private readonly debugLogger?: (message: string) => void;

  constructor(
    private readonly detectors: readonly ToolchainDetector[],
    options: DetectionRegistryOptions = {}
  ) {
    this.minimumConfidence = options.minimumConfidence
      ?? DEFAULT_MINIMUM_CONFIDENCE;
    this.ambiguityDelta = options.ambiguityDelta ?? DEFAULT_AMBIGUITY_DELTA;
    this.debugLogger = options.debugLogger;
    assertUnitInterval(this.minimumConfidence, 'minimumConfidence');
    assertUnitInterval(this.ambiguityDelta, 'ambiguityDelta');
    assertUniqueDetectorIds(detectors);
  }

  async detect(
    artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<DetectionReport> {
    if (signal?.aborted) {
      throw new AnalysisCancelledError();
    }

    const outcomes = await Promise.all(this.detectors.map(async detector => {
      try {
        return {
          detectorId: detector.toolchainId,
          detection: await detector.detect(artifacts, signal),
        };
      } catch (error) {
        if (error instanceof AnalysisCancelledError || signal?.aborted) {
          throw new AnalysisCancelledError();
        }
        if (error instanceof ArtifactInspectionError) {
          return {
            detectorId: detector.toolchainId,
            detection: null,
            diagnostic: error.diagnostic,
          };
        }
        throw error;
      }
    }));

    const detections = outcomes
      .flatMap(outcome => outcome.detection ? [outcome.detection] : [])
      .sort(compareDetections);
    const diagnostics = uniqueDiagnostics(
      [
        ...detections.flatMap(detection => detection.diagnostics),
        ...outcomes.flatMap(outcome =>
          outcome.diagnostic ? [outcome.diagnostic] : []
        ),
      ]
    );

    this.logOutcomes(outcomes);

    const qualifying = detections.filter(detection =>
      detection.confidence >= this.minimumConfidence
    );
    if (qualifying.length === 0) {
      return {
        status: 'unknown',
        detections,
        diagnostics: [
          ...diagnostics,
          createAnalysisDiagnostic({
            code: ANALYSIS_DIAGNOSTIC_CODES.TOOLCHAIN_UNKNOWN,
            severity: 'warning',
            message: 'Build artifacts do not contain enough evidence to identify the toolchain.',
            remediation: 'Provide the linker MAP file or configure the build artifacts explicitly.',
          }),
        ],
      };
    }

    if (
      qualifying.length > 1
      && qualifying[0].confidence - qualifying[1].confidence
        <= this.ambiguityDelta
    ) {
      return {
        status: 'ambiguous',
        detections,
        diagnostics: [
          ...diagnostics,
          createAnalysisDiagnostic({
            code: ANALYSIS_DIAGNOSTIC_CODES.TOOLCHAIN_AMBIGUOUS,
            severity: 'warning',
            message: `Build artifacts contain conflicting evidence for ${qualifying[0].toolchainId} and ${qualifying[1].toolchainId}.`,
            remediation: 'Select artifacts from one build output and remove stale MAP files.',
          }),
        ],
      };
    }

    return {
      status: 'detected',
      detection: qualifying[0],
      detections,
      diagnostics,
    };
  }

  private logOutcomes(outcomes: readonly DetectorOutcome[]): void {
    if (!this.debugLogger) {
      return;
    }

    for (const outcome of [...outcomes].sort((a, b) =>
      a.detectorId.localeCompare(b.detectorId)
    )) {
      if (!outcome.detection) {
        this.debugLogger(
          `[Toolchain detection] ${outcome.detectorId}: no evidence.`
          + (outcome.diagnostic
            ? ` ${outcome.diagnostic.code}: ${outcome.diagnostic.message}`
            : '')
        );
        continue;
      }

      const evidence = outcome.detection.evidence.map(item =>
        `${item.source} +${item.weight}: ${item.description}`
      ).join(' | ');
      this.debugLogger(
        `[Toolchain detection] ${outcome.detectorId}: confidence `
        + `${outcome.detection.confidence.toFixed(3)}; ${evidence}`
      );
    }
  }
}

export function createDefaultDetectors(
  dependencies: DetectorDependencies = {}
): readonly ToolchainDetector[] {
  return [
    new GnuArmDetector(dependencies),
    new GnuRiscVDetector(dependencies),
    new GnuXtensaDetector(dependencies),
    new LlvmDetector(dependencies),
    new KeilDetector(dependencies),
    new IarDetector(dependencies),
  ];
}

export function createDefaultDetectionRegistry(
  dependencies: DetectorDependencies = {},
  options: DetectionRegistryOptions = {}
): DetectionRegistry {
  return new DetectionRegistry(createDefaultDetectors(dependencies), options);
}

function compareDetections(
  left: ToolchainDetection,
  right: ToolchainDetection
): number {
  return right.confidence - left.confidence
    || left.toolchainId.localeCompare(right.toolchainId);
}

function uniqueDiagnostics(
  diagnostics: readonly AnalysisDiagnostic[]
): AnalysisDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter(diagnostic => {
    const key = [
      diagnostic.code,
      diagnostic.artifactPath,
      diagnostic.cause?.message,
    ].join('\0');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function assertUnitInterval(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite number between 0 and 1.`);
  }
}

function assertUniqueDetectorIds(detectors: readonly ToolchainDetector[]): void {
  const seen = new Set<string>();
  for (const detector of detectors) {
    if (seen.has(detector.toolchainId)) {
      throw new Error(`Duplicate detector for ${detector.toolchainId}.`);
    }
    seen.add(detector.toolchainId);
  }
}
