# Analysis contract semantics

The contracts under `src/analysis` are the stable boundary between artifact
discovery, toolchain detection, adapters, orchestration, and presentation. They
now drive the provider's analysis path; the presentation mapper retains the
existing webview's region, section, symbol, and source-link model.

## Artifact and detection semantics

`BuildArtifactSet` permits absent paths so an incomplete selection can produce
an `invalid` result with diagnostics. Detectors return `null` when they have no
evidence. A returned detection carries its evidence and a confidence normalized
to the inclusive range 0 through 1. The detection registry applies deterministic
ranking, selection threshold, and ambiguity rules.

Toolchain IDs distinguish all initially recognized families. `unknown` is a
detection outcome and cannot be used as an adapter or successful-analysis
identity.

## Numeric semantics

Addresses and known byte counts are non-negative JavaScript numbers. Fields
whose absence is meaningful use `null`; zero always means a known numeric zero
and must never stand for unknown data.

- Region and section start addresses and sizes are required because entries
  without those values cannot participate in address mapping.
- `AnalyzedMemoryRegion.used` is `null` when usage cannot be calculated and zero
  only when the adapter knows that no bytes are used.
- `AnalyzedSection.loadAddress` is `null` when no load address is known.
- `AnalyzedSymbol.size` is `null` when symbol size is unavailable.
- Source line and column are one-based and use `null` when unavailable.

Adapters must reject negative, non-finite, or unsafe-integer byte/address values
rather than converting them to zero. Parser-specific validation is added when a
parser is migrated behind an adapter.

## Result and diagnostic semantics

`BuildAnalysisResult` is a discriminated union with `success`, `partial`,
`unsupported`, `unknown`, `ambiguous`, `invalid`, and `cancelled` outcomes.
Unsupported and inconclusive detection are ordinary results, not generic
exceptions. Only `success` and `partial` carry analysis data.

Diagnostics use stable machine-readable codes independently of their messages.
An underlying JavaScript error is normalized to serializable name, message, and
optional system code fields. Artifact paths and remediation are optional so
diagnostics can be displayed by the current webview later without parsing
English text.

Environment validation supports `partial` in addition to `valid` and `invalid`.
This lets an adapter distinguish a missing optional detail tool from a missing
tool that prevents all analysis.

## Phase 1 orchestration policy

The orchestrator validates that both MAP and executable artifacts are readable,
then runs detection, and only then looks up an adapter. The default adapter
registry contains `gnu-arm-none-eabi`, `gnu-riscv-none-elf`, `gnu-xtensa-elf`,
and `llvm`. Recognized Keil/Arm Compiler and IAR Arm builds therefore return
`unsupported` without validating or invoking tools for a different target.

Unknown and conflicting evidence return `unknown` and `ambiguous` unchanged.
An unsupported diagnostic names the detected family, explains that its adapter
is not implemented, and includes remediation. Required-tool failure is
`invalid`; missing optional tooling or adapter warnings produce `partial`.
Cancellation is checked between every asynchronous stage and returned as a
structured `cancelled` result.

The provider maps `success` and `partial` to the existing tables. Unsupported,
unknown, ambiguous, invalid/missing-tool, and cancelled results clear stale
table data and display a severity-appropriate status with remediation. Only
invalid results also produce the existing de-duplicated VS Code error message.

Unexpected detector, validator, or adapter exceptions are caught at the
orchestrator boundary and normalized into a serializable `invalid` result.
Cancellation remains distinct and is never reported as a tool failure.

See [Adding a toolchain adapter](adding-toolchain-adapter.md) for the required
detector, adapter, fixture, registration, and verification steps.

## Shared GNU/binutils foundation

GNU linker MAP parsing, `objdump` section parsing, `nm` symbol parsing, bounded
tool execution, executable-copy handling, and provenance live under
`src/toolchains/gnu`. `GnuBinutilsAdapter` configures this workflow with target
identity, architecture metadata, and executable names. `GnuArmAdapter`,
`GnuRiscVAdapter`, and `GnuXtensaAdapter` remain separate concrete adapters that
supply target-specific identity and executable names. All three are registered
by default.

LLVM reuses the bounded execution and provenance workflow while injecting its
own native LLD region parser and `llvm-objdump` section parser. The region-parser
interface receives selected linker scripts because native LLD MAP output does
not contain region capacities. See [LLVM adapter design](llvm-adapter-design.md).
