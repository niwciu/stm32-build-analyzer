import {
  DetectorDependencies,
  EvidenceBasedDetector,
} from '../detection/EvidenceBasedDetector';

export class KeilDetector extends EvidenceBasedDetector {
  readonly toolchainId = 'keil-armclang' as const;

  constructor(dependencies: DetectorDependencies = {}) {
    super({
      contentRules: [
        {
          pattern: /\bARM Linker,\s*(?:RVCT|ARM Compiler|\d)/i,
          description: 'Arm armlink producer header.',
          weight: 0.7,
        },
        {
          pattern: /^\s*Memory Map of the image\s*$/mi,
          description: 'Arm linker image memory-map heading.',
          weight: 0.45,
        },
        {
          pattern: /\bLoad Region\s+\S+[\s\S]*\bExecution Region\s+\S+/i,
          description: 'Arm linker load/execution region structure.',
          weight: 0.4,
        },
        {
          pattern: /\b(?:armclang|armlink)(?:\.exe)?\b/i,
          description: 'Arm Compiler tool marker.',
          weight: 0.55,
        },
      ],
      fileNameRules: [{
        pattern: /\.axf$/i,
        description: 'Artifact uses the common Arm/Keil AXF extension.',
        weight: 0.1,
      }],
      toolNames: ['armlink', 'armclang', 'fromelf'],
    }, dependencies);
  }
}
