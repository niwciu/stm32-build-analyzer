# Toolchain detection policy

Phase 1 detection is evidence-based and read-only. Detectors inspect MAP text,
the fixed ELF header prefix, and artifact names; they never execute a build artifact. The registry recognizes
GNU Arm Embedded, GNU RISC-V, GNU Xtensa, LLVM LLD, Arm/Keil armlink, and IAR
ILINK. Only GNU Arm has an analysis adapter in this phase.

## Evidence strength

MAP producer strings, target architecture declarations, output-format markers,
format-specific headings, and ELF machine architecture carry the strongest
weights. ELF architecture complements linker-family evidence: an Arm ELF alone
does not prove GNU Arm, while a generic GNU MAP plus `EM_ARM` is sufficient for
backward-compatible detection. Configured tool names, available inspection tools,
and filenames are supporting evidence only. Even a
matching configured and available tool remains below the default selection
threshold when no artifact-content evidence exists.

Confidence is the bounded sum of a detector's evidence weights. The registry:

1. sorts candidates by descending confidence and then toolchain ID;
2. requires confidence `0.6` or greater;
3. reports ambiguity when the two leading qualifying candidates differ by no
   more than `0.1`;
4. reports unknown when no candidate qualifies.

Debug logging receives every detector's score and complete evidence list in
stable toolchain-ID order. Detection reports retain the same structured
evidence for future UI diagnostics.

## Current limitations

- Phase 1 reads ELF class, byte order, and machine metadata only. It does not
  yet parse ELF producer comments or target-specific attributes.
- The fixtures are minimal, synthetic excerpts derived from GNU Binutils, LLVM
  LLD, Arm linker, and IAR linker documentation. Their manifests record exact
  documentation references and case-specific limitations.
- Vendor-specific GNU Xtensa triples and older/newer proprietary MAP layouts
  need legally redistributable real fixtures before support can be claimed.
- A generic GNU linker MAP without architecture evidence from either the MAP or
  ELF header is intentionally unknown. Mixed strong markers are intentionally
  ambiguous.
