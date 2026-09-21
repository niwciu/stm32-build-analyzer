# Toolchain detection policy

Phase 1 detection is evidence-based and read-only. Detectors inspect MAP text,
the fixed ELF header prefix, and artifact names; they never execute a build
artifact. The registry recognizes GNU Arm Embedded, GNU RISC-V, GNU Xtensa,
LLVM LLD, Arm/Keil armlink, and IAR ILINK. GNU Arm, GNU RISC-V, and the verified
Espressif GNU Xtensa variants have analysis adapters.

## Support and result states

| Detected family | Current behavior |
| --- | --- |
| GNU Arm Embedded (`arm-none-eabi`) | Supported; validates GNU Arm tools and analyzes memory, sections, and symbols. |
| GNU RISC-V Embedded | Supported; validates GNU RISC-V tools and analyzes memory, sections, and symbols. |
| GNU Xtensa Embedded | Supported for the verified Espressif ESP32, ESP32-S2, and ESP32-S3 variants described below. |
| LLVM/Clang | Recognized; returns `unsupported` without invoking GNU Arm tools. |
| Keil/Arm Compiler | Recognized; returns `unsupported` without invoking GNU Arm tools. |
| IAR Embedded Workbench for Arm | Recognized; returns `unsupported` without invoking GNU Arm tools. |

`unknown` means no detector reached the selection threshold. `ambiguous` means
the leading candidates are within the configured ambiguity window. Missing or
unreadable artifacts and unusable required tools return `invalid`. These states
are displayed in the webview and do not fall through to another adapter.

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

- Detection reads ELF class, byte order, and machine metadata only. It does not
  yet parse ELF producer comments or target-specific attributes.
- Most fixtures are minimal, synthetic excerpts derived from GNU Binutils, LLVM
  LLD, Arm linker, and IAR linker documentation. GNU RISC-V additionally has a
  real, freestanding RV32IMAC/ILP32 fixture generated with GNU Binutils 2.42.
  Fixture manifests record provenance and case-specific limitations.
- GNU RISC-V tool discovery supports the `riscv64-unknown-elf-`,
  `riscv32-unknown-elf-`, `riscv64-none-elf-`, `riscv32-none-elf-`, and
  `riscv-none-elf-` prefixes. The configured toolchain directory takes
  precedence over `PATH`.
- GNU Xtensa tool discovery supports Espressif's current unified
  `xtensa-esp-elf-` prefix and the legacy `xtensa-esp32-elf-`,
  `xtensa-esp32s2-elf-`, and `xtensa-esp32s3-elf-` prefixes. Real freestanding
  fixtures cover the ESP32, ESP32-S2, and ESP32-S3 CPU configurations of the
  unified toolchain, and a documented synthetic fixture covers the wider
  multi-region ESP-IDF MAP layout.
- ESP8266/LX106, non-Espressif or custom Xtensa cores, big-endian Xtensa, and
  proprietary MAP layouts remain explicitly unsupported. Full compatibility
  is not claimed for every ESP-IDF configuration; configurations that produce
  materially different MAP or ELF output need a recorded fixture first.
- A generic GNU linker MAP without architecture evidence from either the MAP or
  ELF header is intentionally unknown. Mixed strong markers are intentionally
  ambiguous.
