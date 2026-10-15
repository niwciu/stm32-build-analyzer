# STM32 Build Analyzer Enhanced v1.2.0 Pre-release

2026-09-22

This opt-in test release adds adapter-based multi-toolchain analysis while
retaining the existing STM32 Build Analyzer (Enhanced) name, Marketplace
identity, commands, views, and configuration keys.

## New toolchain adapters

- GNU Arm Embedded remains supported through the refactored common pipeline.
- GNU RISC-V supports GNU ld MAP plus ELF analysis with matching GNU object
  tools; the real regression artifact is RV32IMAC with Binutils 2.42.
- Espressif GNU Xtensa supports verified ESP32, ESP32-S2, and ESP32-S3 tool
  prefixes; real fixtures use GCC 16.1.0 and Binutils 2.46.
- LLVM supports native LLD MAP plus ELF analysis using `llvm-objdump` and
  optional `llvm-nm`; verified real coverage uses LLVM 18.1.3 and requires a
  materialized linker script with literal `MEMORY` values.
- Keil parses self-contained armlink MAP reports without proprietary tools.
  Arm Compiler 5.06 update 5 is verified with a real report; the 6.21 format is
  experimental.
- IAR parses self-contained ILINK MAP reports without proprietary tools. ILINK
  7.80.1.28 is verified with a real report; the 9.50.1 format is experimental.

## Detection and safety

The analyzer combines deterministic MAP, ELF, filename, configured-tool, and
available-tool evidence. It reports unknown or ambiguous results instead of
guessing and routes a supported result only to the matching adapter. Firmware
artifacts are never executed. External inspection tools use bounded,
cancellable execution and remain disabled in untrusted workspaces.

Keil `.axf` and IAR `.out` files can now be discovered, paired, and watched in
addition to `.elf` files. MAP-only Keil and IAR adapters do not invoke those
executables.

## Testing focus

Please test automatic detection, memory-region totals, section placement,
symbols/source links, missing-tool diagnostics, cancellation, and refresh after
rebuilding. When reporting a problem, include the detected toolchain, compiler
and linker versions, target architecture, and a redacted MAP header or minimal
reproducer where licensing permits.

This release contains 310 automated extension-host tests. Public runtime
third-party adapter registration and product rebranding are intentionally
deferred until after pre-release feedback.
