import {
  DetectorDependencies,
  EvidenceBasedDetector,
} from '../detection/EvidenceBasedDetector';

export class GnuArmDetector extends EvidenceBasedDetector {
  readonly toolchainId = 'gnu-arm-none-eabi' as const;

  constructor(dependencies: DetectorDependencies = {}) {
    super({
      contentRules: [
        {
          pattern: /\barm-none-eabi-(?:gcc|g\+\+|ld|objdump)\b/i,
          description: 'GNU Arm Embedded producer or tool marker.',
          weight: 0.8,
        },
        {
          pattern: /OUTPUT_ARCH\s*\(\s*(?:arm|armv\d[^)]*)\s*\)/i,
          description: 'GNU linker output architecture is Arm.',
          weight: 0.55,
        },
        {
          pattern: /\belf32-(?:little|big)?arm\b/i,
          description: 'GNU linker output format identifies 32-bit Arm ELF.',
          weight: 0.55,
        },
        {
          pattern: /^Memory Configuration\s*$[\s\S]*^Linker script and memory map\s*$/mi,
          description: 'GNU linker MAP structure is present.',
          weight: 0.35,
        },
      ],
      fileNameRules: [{
        pattern: /(?:^|[-_.])arm(?:[-_.]|$)/i,
        description: 'Artifact filename contains an Arm target hint.',
        weight: 0.05,
      }],
      toolNames: ['arm-none-eabi-objdump', 'arm-none-eabi-ld'],
    }, dependencies);
  }
}
