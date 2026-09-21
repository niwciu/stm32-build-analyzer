import {
  DetectorDependencies,
  EvidenceBasedDetector,
} from '../detection/EvidenceBasedDetector';

export class GnuRiscVDetector extends EvidenceBasedDetector {
  readonly toolchainId = 'gnu-riscv-none-elf' as const;

  constructor(dependencies: DetectorDependencies = {}) {
    super({
      contentRules: [
        {
          pattern: /\briscv(?:32|64)?-(?:none|unknown)-(?:elf|eabi)-(?:gcc|g\+\+|ld|objdump)\b/i,
          description: 'GNU RISC-V producer or tool marker.',
          weight: 0.8,
        },
        {
          pattern: /OUTPUT_ARCH\s*\(\s*riscv(?::[^)]*)?\s*\)/i,
          description: 'GNU linker output architecture is RISC-V.',
          weight: 0.65,
        },
        {
          pattern: /\belf(?:32|64)-littleriscv\b/i,
          description: 'GNU linker output format identifies RISC-V ELF.',
          weight: 0.65,
        },
        {
          pattern: /^Memory Configuration\s*$[\s\S]*^Linker script and memory map\s*$/mi,
          description: 'GNU linker MAP structure is present.',
          weight: 0.25,
        },
      ],
      elfMachineRules: [{
        machines: [243],
        description: 'ELF machine architecture is RISC-V (EM_RISCV).',
        weight: 0.4,
      }],
      fileNameRules: [{
        pattern: /(?:^|[-_.])riscv(?:32|64)?(?:[-_.]|$)/i,
        description: 'Artifact filename contains a RISC-V target hint.',
        weight: 0.1,
      }],
      toolNames: [
        'riscv64-unknown-elf-objdump',
        'riscv32-unknown-elf-objdump',
        'riscv64-none-elf-objdump',
        'riscv32-none-elf-objdump',
        'riscv-none-elf-objdump',
      ],
    }, dependencies);
  }
}
