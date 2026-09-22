# Toolchain detection policy

Phase 1 detection is evidence-based and read-only. Detectors inspect MAP text,
the fixed ELF header prefix, and artifact names; they never execute a build
artifact. The registry recognizes GNU Arm Embedded, GNU RISC-V, GNU Xtensa,
LLVM LLD, Arm/Keil armlink, and IAR ILINK. Every family has an analysis adapter
for the exact verified variants and formats listed below.

## Support and result states

| Detected family | Current behavior |
| --- | --- |
| GNU Arm Embedded (`arm-none-eabi`) | Supported; validates GNU Arm tools and analyzes memory, sections, and symbols. |
| GNU RISC-V Embedded | Supported; validates GNU RISC-V tools and analyzes memory, sections, and symbols. |
| GNU Xtensa Embedded | Supported for the verified Espressif ESP32, ESP32-S2, and ESP32-S3 variants described below. |
| LLVM/Clang | Supported for native LLD ELF/MAP output with materialized literal `MEMORY` declarations. |
| Keil/Arm Compiler | Arm Compiler 5.06 update 5 MAP analysis is supported; the documented Arm Compiler 6.21 layout is experimental. |
| IAR Embedded Workbench for Arm | ILINK 7.80.1.28 runtime MAP analysis is supported; ILINK 9.50.1 is experimental. |

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
- Synthetic fixtures are minimal excerpts derived from GNU Binutils, LLVM LLD,
  Arm linker, and IAR linker documentation. GNU RISC-V, the verified Espressif
  GNU Xtensa targets, and LLVM additionally have real freestanding fixtures.
  Keil and IAR have real, openly licensed MAP fixtures plus version-specific
  synthetic cases. Fixture manifests record generator versions, provenance,
  and case-specific limitations.
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
- LLVM analysis uses `llvm-objdump` and `llvm-nm`. Native LLD MAP files provide
  section placement but not region capacity, so analysis also requires a
  materialized linker script with numeric `MEMORY` origins and lengths. The
  provider searches for one unambiguous script from the build output directory
  through the workspace root. Computed expressions and GNU-style MAP output
  from Clang builds are not yet supported. See
  [LLVM adapter design](llvm-adapter-design.md).
- Keil analysis parses armlink MAP reports without invoking AXF files or
  proprietary tools. Arm Compiler 5.06 update 5 has real-fixture coverage;
  Arm Compiler 6.21 currently has documented synthetic coverage only. Missing
  execution-region declarations produce partial results rather than inferred
  capacities. See [Keil adapter design](keil-adapter-design.md).
- IAR analysis parses numeric ILINK placement ranges without invoking `.out`
  files or proprietary tools. ILINK 7.80.1.28 has real-fixture coverage;
  ILINK 9.50.1 currently has synthetic coverage. Initialized RAM data is mapped
  at runtime, but missing ROM load addresses make that analysis partial. See
  [IAR adapter design](iar-adapter-design.md).
- A generic GNU linker MAP without architecture evidence from either the MAP or
  ELF header is intentionally unknown. Mixed strong markers are intentionally
  ambiguous.
