# Analysis contract semantics

The contracts under `src/analysis` are the stable boundary between artifact
discovery, toolchain detection, adapters, orchestration, and presentation. They
do not replace the current GNU Arm execution path until later migration steps.

## Artifact and detection semantics

`BuildArtifactSet` permits absent paths so an incomplete selection can produce
an `invalid` result with diagnostics. Detectors return `null` when they have no
evidence. A returned detection carries its evidence and a confidence normalized
to the inclusive range 0 through 1; ranking and range enforcement belong to the
future detection registry.

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
