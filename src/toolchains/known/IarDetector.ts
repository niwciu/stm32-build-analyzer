import {
  DetectorDependencies,
  EvidenceBasedDetector,
} from '../detection/EvidenceBasedDetector';

export class IarDetector extends EvidenceBasedDetector {
  readonly toolchainId = 'iar-arm' as const;

  constructor(dependencies: DetectorDependencies = {}) {
    super({
      contentRules: [
        {
          pattern: /\bIAR (?:ELF )?Linker(?: for Arm)?\b/i,
          description: 'IAR ILINK producer header.',
          weight: 0.75,
        },
        {
          pattern: /^\s*PLACEMENT SUMMARY\s*$/mi,
          description: 'IAR linker placement-summary heading.',
          weight: 0.45,
        },
        {
          pattern: /^\s*MODULE SUMMARY\s*$/mi,
          description: 'IAR linker module-summary heading.',
          weight: 0.35,
        },
        {
          pattern: /\bilinkarm(?:\.exe)?\b/i,
          description: 'IAR Arm linker tool marker.',
          weight: 0.6,
        },
      ],
      toolNames: ['ilinkarm', 'ielfdumparm'],
    }, dependencies);
  }
}
