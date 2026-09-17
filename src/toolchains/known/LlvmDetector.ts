import {
  DetectorDependencies,
  EvidenceBasedDetector,
} from '../detection/EvidenceBasedDetector';

export class LlvmDetector extends EvidenceBasedDetector {
  readonly toolchainId = 'llvm' as const;

  constructor(dependencies: DetectorDependencies = {}) {
    super({
      contentRules: [
        {
          pattern: /(?:\bLinker\s*:\s*LLD\b|\bLLD\s+\d+(?:\.\d+)+)/i,
          description: 'LLVM LLD producer marker.',
          weight: 0.7,
        },
        {
          pattern: /^\s*VMA\s+LMA\s+Size\s+Align\s+Out\s+In\s+Symbol\s*$/mi,
          description: 'LLVM LLD native MAP column header.',
          weight: 0.65,
        },
        {
          pattern: /\b(?:clang|ld\.lld)(?:\.exe)?\b/i,
          description: 'LLVM compiler or linker marker.',
          weight: 0.55,
        },
      ],
      fileNameRules: [{
        pattern: /(?:^|[-_.])(?:clang|llvm|lld)(?:[-_.]|$)/i,
        description: 'Artifact filename contains an LLVM toolchain hint.',
        weight: 0.1,
      }],
      toolNames: ['ld.lld', 'clang', 'llvm-objdump'],
    }, dependencies);
  }
}
