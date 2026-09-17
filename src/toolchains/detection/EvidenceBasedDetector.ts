import * as path from 'path';
import type { BuildArtifactSet } from '../../artifacts/BuildArtifactSet';
import {
  ArtifactInspector,
  FileArtifactInspector,
} from '../../artifacts/ArtifactInspector';
import type {
  DetectionEvidence,
  DetectionEvidenceSource,
  KnownToolchainId,
  ToolchainDetection,
  ToolchainDetector,
} from '../../analysis/contracts';
import { AnalysisCancelledError } from '../../utils/errors';

export interface ToolAvailabilityProbe {
  isAvailable(tool: string, signal?: AbortSignal): Promise<boolean>;
}

export interface DetectorDependencies {
  readonly artifactInspector?: ArtifactInspector;
  readonly toolAvailability?: ToolAvailabilityProbe;
  readonly configuredToolNames?: readonly string[];
}

export interface EvidenceRule {
  readonly pattern: RegExp;
  readonly description: string;
  readonly weight: number;
}

export interface DetectorDefinition {
  readonly contentRules: readonly EvidenceRule[];
  readonly fileNameRules?: readonly EvidenceRule[];
  readonly toolNames?: readonly string[];
}

export abstract class EvidenceBasedDetector implements ToolchainDetector {
  abstract readonly toolchainId: KnownToolchainId;

  private readonly artifactInspector: ArtifactInspector;
  private readonly toolAvailability?: ToolAvailabilityProbe;
  private readonly configuredToolNames: ReadonlySet<string>;

  protected constructor(
    private readonly definition: DetectorDefinition,
    dependencies: DetectorDependencies = {}
  ) {
    this.artifactInspector = dependencies.artifactInspector
      ?? new FileArtifactInspector();
    this.toolAvailability = dependencies.toolAvailability;
    this.configuredToolNames = new Set(
      (dependencies.configuredToolNames ?? []).map(normalizeToolName)
    );
  }

  async detect(
    artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<ToolchainDetection | null> {
    throwIfCancelled(signal);
    const evidence: DetectionEvidence[] = [];

    if (artifacts.mapPath) {
      const mapContent = await this.artifactInspector.readText(
        artifacts.mapPath,
        signal
      );
      addMatchingEvidence(
        evidence,
        mapContent,
        this.definition.contentRules,
        'file-content'
      );
    }

    this.addConfiguredToolEvidence(evidence);
    await this.addAvailableToolEvidence(evidence, signal);
    this.addFileNameEvidence(evidence, artifacts);
    throwIfCancelled(signal);

    if (evidence.length === 0) {
      return null;
    }

    return {
      toolchainId: this.toolchainId,
      confidence: normalizeConfidence(
        evidence.reduce((total, item) => total + item.weight, 0)
      ),
      evidence,
      diagnostics: [],
    };
  }

  private addConfiguredToolEvidence(evidence: DetectionEvidence[]): void {
    const matchingTool = this.definition.toolNames?.find(tool =>
      this.configuredToolNames.has(normalizeToolName(tool))
    );
    if (matchingTool) {
      evidence.push({
        source: 'configured-tool',
        description: `Configured tool name matches ${matchingTool}.`,
        weight: 0.15,
      });
    }
  }

  private async addAvailableToolEvidence(
    evidence: DetectionEvidence[],
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.toolAvailability) {
      return;
    }

    for (const tool of this.definition.toolNames ?? []) {
      throwIfCancelled(signal);
      if (await this.toolAvailability.isAvailable(tool, signal)) {
        evidence.push({
          source: 'available-tool',
          description: `${tool} is available for inspection.`,
          weight: 0.05,
        });
        return;
      }
    }
  }

  private addFileNameEvidence(
    evidence: DetectionEvidence[],
    artifacts: BuildArtifactSet
  ): void {
    const names = [
      artifacts.mapPath,
      artifacts.executablePath,
      ...artifacts.linkerScriptPaths,
    ].filter((candidate): candidate is string => candidate !== undefined)
      .map(candidate => path.basename(candidate));

    for (const rule of this.definition.fileNameRules ?? []) {
      if (names.some(name => matches(rule.pattern, name))) {
        evidence.push({
          source: 'file-name',
          description: rule.description,
          weight: rule.weight,
        });
      }
    }
  }
}

function addMatchingEvidence(
  evidence: DetectionEvidence[],
  input: string,
  rules: readonly EvidenceRule[],
  source: DetectionEvidenceSource
): void {
  for (const rule of rules) {
    if (matches(rule.pattern, input)) {
      evidence.push({
        source,
        description: rule.description,
        weight: rule.weight,
      });
    }
  }
}

function matches(pattern: RegExp, input: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(input);
}

function normalizeToolName(tool: string): string {
  return path.basename(tool).replace(/\.exe$/i, '').toLowerCase();
}

function normalizeConfidence(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AnalysisCancelledError();
  }
}
