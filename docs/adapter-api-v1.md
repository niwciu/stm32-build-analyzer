# Adapter API v1 and trust model

## Status and scope

Adapter API v1 is the compatibility boundary for built-in adapters maintained
in this repository. It was reviewed after six implementations exercised three
materially different workflows:

- GNU Arm, RISC-V, and Xtensa use GNU binutils;
- LLVM uses its native LLD MAP and object-tool formats;
- Keil and IAR analyze vendor MAP reports without invoking proprietary tools.

The common `ToolchainAdapter` input, environment validation, analysis model,
diagnostics, cancellation, and provenance semantics held across those
workflows. Built-in registrations therefore carry
`TOOLCHAIN_ADAPTER_API_VERSION = 1` and are checked before entering the adapter
registry.

API v1 is not a published runtime plugin API. The VS Code extension activation
result exposes no registration method. The current `KnownToolchainId` set,
display-name mapping, detector creation, settings, and presentation metadata
are intentionally closed and compiled with the extension. Accepting arbitrary
identifiers now would either weaken those guarantees or require unversioned
side channels. Runtime registration remains deferred until those dependencies
are represented by one coherent contribution contract.

## Version 1 compatibility contract

An adapter contribution contains an `apiVersion` of `1` and one
`ToolchainAdapter`. The adapter must:

- use one registered `KnownToolchainId`, identical to its detector ID;
- treat `BuildArtifactSet` paths as input data and never execute the target;
- return `valid`, `partial`, or `invalid` environment validation with stable
  diagnostics instead of relying on thrown process errors;
- produce only the common `BuildAnalysis` model and preserve the documented
  null-versus-zero numeric semantics;
- identify itself consistently in toolchain metadata and provenance;
- honor `AbortSignal` in validation, file access, and analysis;
- record every external inspection invocation in provenance;
- avoid UI, workspace-discovery, or build-system assumptions.

Adding optional fields is compatible when existing consumers retain their
meaning. Removing or renaming fields, changing numeric or result semantics,
making an optional capability mandatory, or changing method signatures
requires a new API version and compatibility path.

Compatibility is enforced at several levels: TypeScript checks adapter shape,
the contribution registry rejects unsupported versions and duplicate IDs,
shared adapter tests verify behavior, fixture conformance tests verify declared
inputs and expected results, and the orchestration suite verifies routing and
structured outcomes. Every adapter must also pass the release checks listed in
[Adding a toolchain adapter](adding-toolchain-adapter.md).

## Executable and workspace trust rules

An adapter that uses an external tool expands the extension's native-code trust
boundary. Built-in and any future third-party adapters must follow these rules:

1. Analysis stays disabled in an untrusted workspace. Tool path settings remain
   restricted there.
2. Never execute the firmware artifact, linker script, MAP file, object file,
   or a binary discovered beside build output merely because it has a familiar
   name.
3. Resolve only explicitly configured inspection tools or known tool names from
   controlled search locations. Do not infer an executable command from
   artifact content.
4. Invoke tools without a shell, pass arguments as an array, and use the shared
   bounded runner for cancellation, timeout, and stdout/stderr limits.
5. Analyze disposable copies when a vendor tool can modify its input. Never
   modify build artifacts in place.
6. Record resolved executable paths, arguments, and known versions in
   provenance. Diagnostics must not expose secrets from the environment or
   unrestricted tool output.
7. Do not package or download proprietary inspection tools. Users supply tools
   under their applicable licenses.
8. Fixture licenses and provenance must permit redistribution. Tests must not
   execute fixture binaries.

A future public plugin API additionally needs extension identity and lifecycle
ownership, contribution disposal, arbitrary-ID/display metadata, settings
namespacing, capability declarations, API-version negotiation, and a clear
statement that third-party adapter code is not sandboxed from the VS Code
extension host. Until those controls exist, external registration must not be
added through commands, global state, configuration, or the activation return
value.
