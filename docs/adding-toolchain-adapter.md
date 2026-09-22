# Adding a toolchain adapter

Toolchain support is added in two deliberate stages: recognition by a detector,
then analysis by an adapter. Registering a detector must not implicitly route
its artifacts through an existing adapter.

The built-in adapter boundary is versioned by
`TOOLCHAIN_ADAPTER_API_VERSION` in `src/analysis/adapterApi.ts`. Version 1 is
the compatibility target for adapters maintained in this repository. Define a
completed adapter with `defineToolchainAdapterV1` and register the resulting
contribution through `AdapterRegistry.fromContributions`. A version change is
required for an incompatible contract or semantic change.

This is not a public runtime plugin API. The extension's `activate` function
does not expose registration, and third-party extensions cannot add adapters at
runtime. See [Adapter API v1 and trust model](adapter-api-v1.md) for the review
decision, compatibility rules, and security requirements.

## 1. Define the identity and detection evidence

1. Add the stable ID to `ToolchainId` in `src/analysis/contracts.ts` and add its
   display name in `src/analysis/AnalysisOrchestrator.ts`.
2. Implement `ToolchainDetector`, normally by extending
   `EvidenceBasedDetector`. Prefer producer strings, target declarations,
   format-specific headings, or ELF metadata over filenames and installed-tool
   probes.
3. Register the detector in `createDefaultDetectors`. Detector ordering must not
   affect the result; ranking uses confidence followed by toolchain ID.
4. Add positive, negative, and competing-detector tests. A configured or
   available binary must never be enough to select a toolchain on its own.

A recognized family without an adapter must return `unsupported`. Keep this
state until its analysis implementation and fixtures are complete.

## 2. Implement the adapter boundary

Implement `ToolchainAdapter` with these responsibilities:

- `validateEnvironment` resolves tools, records versions when available, and
  distinguishes required failures (`invalid`) from optional loss (`partial`);
- `analyze` produces the common region, section, symbol, source-location, and
  provenance model;
- unknown numeric values remain `null`; zero is only a known zero;
- every external process uses the shared runner with cancellation, timeout, and
  output limits;
- build executables are inspected as data and are never executed;
- failures carry structured diagnostics and actionable remediation.

Inject file inspection, tool resolution, and process execution so tests do not
depend on a locally installed vendor toolchain. Add the adapter to
`createDefaultAdapterRegistry` as a version 1 contribution only when its
contract and fixture tests pass.
The adapter ID must exactly match its detector ID.

For GNU/binutils families, extend `GnuBinutilsAdapter` instead of duplicating
the linker-map, `objdump`, `nm`, process-control, and provenance workflow. Each
concrete adapter supplies a `GnuBinutilsAdapterDefinition` containing its
display name, target architecture, executable names, log label, and temporary
directory prefix. Keep the concrete class free of branches for other GNU
targets and register it independently. Apply the reusable contract in
`src/test/contracts/gnuAdapterContract.ts` to every concrete GNU adapter.

## 3. Add fixtures

Create cases below:

```text
src/test/fixtures/toolchains/<toolchain-id>/<case-id>/
```

At minimum, add a detection case before registering a detector and an analysis
case before registering an adapter. Follow the complete manifest and provenance
rules in [the fixture guide](../src/test/fixtures/README.md). Synthetic inputs
must cite primary format/tool documentation and state their limitations. Real
artifacts must also record compiler version, target, flags, licenses,
provenance, and the generation command. Tests never execute fixture binaries.

Every file in a fixture case must be declared in `fixture.json`. The conformance
suite discovers valid cases automatically, while detector and adapter tests
must consume their expected output and verify behavior.

## 4. Prove isolation and presentation

Before changing a family from recognized to supported, verify:

- its positive fixture is selected at or above the confidence threshold;
- generic, malformed, and competing-family fixtures do not select it;
- other recognized families never invoke the new adapter;
- required-tool, optional-tool, cancellation, and unexpected-failure paths
  return the appropriate structured status;
- analysis provenance lists the adapter, artifacts, and tool invocations;
- the existing presentation mapper can display its common result without a
  toolchain-specific UI branch.

Run the complete release checks:

```sh
npm run compile-tests
npm run lint
npm test
npm run package
npm run vsix
```

When legally redistributable real artifacts are available, run one manual
analysis and record the compiler/tool versions and observed result. Synthetic
fixtures alone are not evidence of broad real-world compatibility.
