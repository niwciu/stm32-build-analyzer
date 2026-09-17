# Toolchain fixture conventions

Toolchain fixtures live below `toolchains/<toolchain-id>/<case-id>/`. Every
immediate case directory must contain `fixture.json`; the test loader discovers
all manifests recursively and validates the entire tree before tests run.

## Manifest schema version 1

```json
{
  "schemaVersion": 1,
  "id": "globally-unique-fixture-id",
  "toolchain": "parent-toolchain-directory-name",
  "kind": "analysis",
  "origin": {
    "type": "synthetic",
    "documentation": ["primary documentation URL or title"],
    "notes": "How the data was created and what it does not prove."
  },
  "inputs": {
    "map": "firmware.map",
    "objdumpStdout": "objdump-sections.txt",
    "nmStdout": "nm-symbols.txt"
  },
  "expected": "expected-analysis.json",
  "ignored": []
}
```

`kind` is either `analysis` or `detection`. Analysis cases point `expected` to
an analysis JSON file; detection cases point it to a detection JSON file. Input
keys are descriptive and extensible so later adapters can declare their own
captured reports. All paths are relative to the case directory and must remain
inside it.

Every file below a case directory must be the manifest, an `inputs` value, the
`expected` value, or an explicit `ignored` entry. Missing declarations, missing
files, duplicate paths, duplicate fixture IDs, misplaced manifests, unknown
kinds, and a mismatch between `toolchain` and the parent directory fail the
fixture-conformance suite.

Synthetic fixtures require at least one documentation reference and notes that
state their limitations. Real fixtures additionally require `compilerVersion`,
`targetArchitecture`, `buildFlags`, `sourceLicense`, `artifactLicense`,
`provenance`, and `generationCommand` in `origin`. Fixture binaries are never
executed by tests.

Adding a valid case directory automatically registers a parameterized
conformance test. Parser or adapter tests may consume the same loaded paths and
expected JSON without maintaining a separate fixture list.

Detection expected files use one of these forms:

```json
{ "status": "detected", "toolchainId": "llvm", "minimumConfidence": 0.6,
  "requiredEvidenceSources": ["file-content"] }
{ "status": "unknown" }
{ "status": "ambiguous", "toolchainIds": ["gnu-arm-none-eabi", "iar-arm"] }
```

Detection tests discover every `kind: "detection"` fixture, validate the
registry outcome, and also run each positive input against competing detectors.
