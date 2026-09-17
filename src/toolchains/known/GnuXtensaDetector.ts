import {
  DetectorDependencies,
  EvidenceBasedDetector,
} from '../detection/EvidenceBasedDetector';

export class GnuXtensaDetector extends EvidenceBasedDetector {
  readonly toolchainId = 'gnu-xtensa-elf' as const;

  constructor(dependencies: DetectorDependencies = {}) {
    super({
      contentRules: [
        {
          pattern: /\bxtensa[-\w]*-elf-(?:gcc|g\+\+|ld|objdump)\b/i,
          description: 'GNU Xtensa producer or tool marker.',
          weight: 0.8,
        },
        {
          pattern: /OUTPUT_ARCH\s*\(\s*xtensa(?::[^)]*)?\s*\)/i,
          description: 'GNU linker output architecture is Xtensa.',
          weight: 0.65,
        },
        {
          pattern: /\belf32-xtensa(?:-?(?:le|be))?\b/i,
          description: 'GNU linker output format identifies Xtensa ELF.',
          weight: 0.65,
        },
        {
          pattern: /^Memory Configuration\s*$[\s\S]*^Linker script and memory map\s*$/mi,
          description: 'GNU linker MAP structure is present.',
          weight: 0.25,
        },
      ],
      fileNameRules: [{
        pattern: /(?:^|[-_.])xtensa(?:[-_.]|$)/i,
        description: 'Artifact filename contains an Xtensa target hint.',
        weight: 0.1,
      }],
      toolNames: ['xtensa-elf-objdump', 'xtensa-esp32-elf-objdump'],
    }, dependencies);
  }
}
