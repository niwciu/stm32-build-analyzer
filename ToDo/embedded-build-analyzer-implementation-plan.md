# Embedded Build Analyzer: adapter architecture and toolchain roadmap

## 1. Purpose

This document defines a staged migration of STM32 Build Analyzer (Enhanced) into an extensible Embedded Build Analyzer. The target product analyzes embedded build artifacts through toolchain-specific adapters while exposing one stable analysis model to the existing VS Code UI.

The migration must preserve current users, settings, commands, and GNU Arm behavior. Work is divided into approval-gated steps. A coding agent must implement and verify only one approved step at a time, report the evidence, and stop before starting the next step.

The first implementation phase provides:

- a refactored adapter-based architecture;
- automatic toolchain detection;
- one functional adapter: GNU Arm (`arm-none-eabi`);
- an explicit unsupported-toolchain result for every recognized but unimplemented toolchain;
- an explicit unknown-toolchain result when detection is inconclusive;
- comprehensive unit, integration, regression, and fixture-driven tests.

Subsequent phases add toolchains one at a time without changing the UI-facing analysis contract.

## 2. Scope and terminology

### 2.1 Build system versus toolchain

These concepts must remain separate:

- **Build system**: CMake, Make, Ninja, STM32CubeIDE project builder, west, custom scripts, and similar orchestration tools.
- **Toolchain**: GNU Arm Embedded, generic GNU, LLVM, Arm Compiler/Keil, IAR, and similar compiler/linker/binutils families.
- **Artifacts**: ELF/AXF/OUT executable files, linker MAP files, optional linker scripts, and tool-generated reports.
- **Adapter**: a component that detects, validates, and analyzes artifacts from one toolchain family.

The analyzer should remain independent of the build system. Toolchain support is based on artifacts and available inspection binaries, not on how the build was invoked.

### 2.2 Meaning of "automatic detection"

Automatic detection does not mean guessing silently. It means collecting deterministic evidence and returning a confidence-bearing result with reasons. Possible outcomes are:

1. `supported`: a matching adapter is implemented and can attempt analysis;
2. `unsupported`: a known toolchain is detected but its adapter is not implemented;
3. `unknown`: available evidence is insufficient or conflicting;
4. `ambiguous`: two or more candidates have equivalent confidence and user selection is required;
5. `invalid`: artifacts are missing, unreadable, or structurally inconsistent.

Unsupported and unknown outcomes are valid analysis results, not generic exceptions.

## 3. Product and compatibility goals

### 3.1 Goals

- Preserve existing STM32/GNU Arm functionality throughout the migration.
- Decouple discovery, detection, analysis, process execution, and presentation.
- Make each toolchain integration independently implementable and testable.
- Make detection evidence visible in diagnostics and user-facing results.
- Allow synthetic fixtures to be replaced gradually with real artifacts.
- Automatically exercise every complete fixture case added under the fixture root.
- Avoid requiring a particular build system or directory layout.
- Keep the architecture open for community-provided adapters.

### 3.2 Non-goals for the first phase

- Implementing Keil, IAR, LLVM, RISC-V, Xtensa, or host GCC analysis.
- Rebranding Marketplace identifiers or breaking existing configuration keys.
- Building firmware inside extension tests.
- Distributing proprietary vendor binaries or copyrighted example projects.
- Claiming universal support based only on an ELF file extension.
- Replacing the existing UI except where needed to show detection/support status.

### 3.3 Backward compatibility constraints

Until a separately approved migration changes them, retain:

- extension identifier `niwciu.stm32-build-analyzer-enhanced`;
- package `name` and `publisher`;
- command IDs beginning with `stm32BuildAnalyzerEnhanced`;
- configuration keys beginning with `stm32BuildAnalyzerEnhanced`;
- current automatic and manual MAP/ELF pair handling;
- current GNU Arm output for supported existing projects.

Display labels may be changed only in a separately approved branding step.

## 4. Target architecture

### 4.1 Responsibility boundaries

```text
Build discovery
    -> artifact set
Toolchain detection registry
    -> detection report
Adapter registry/orchestrator
    -> selected adapter or unsupported result
Toolchain adapter
    -> common BuildAnalysisResult
View-model mapper
    -> current webview/UI model
```

The architecture should use dependency injection for file inspection and process execution so detection and analysis can be tested without installed vendor tools.

### 4.2 Suggested module layout

The exact names may be adjusted to match repository conventions, but the boundaries must be preserved.

```text
src/
  analysis/
    contracts.ts
    AnalysisOrchestrator.ts
    AdapterRegistry.ts
    DetectionRegistry.ts
    diagnostics.ts
  artifacts/
    BuildArtifactSet.ts
    ArtifactInspector.ts
  process/
    ToolRunner.ts
    ToolResolver.ts
  toolchains/
    gnu-arm/
      GnuArmDetector.ts
      GnuArmAdapter.ts
      GnuLinkerMapParser.ts
      GnuBinutilsParser.ts
    known/
      LlvmDetector.ts
      KeilDetector.ts
      IarDetector.ts
      GnuRiscVDetector.ts
      GnuXtensaDetector.ts
  presentation/
    analysisViewModel.ts
```

Existing modules should be migrated incrementally rather than copied and left in parallel indefinitely.

### 4.3 Core contracts

The contracts below describe the required semantics. Their final TypeScript spelling should be agreed during implementation.

```ts
type ToolchainId =
  | 'gnu-arm-none-eabi'
  | 'gnu-riscv-none-elf'
  | 'gnu-xtensa-elf'
  | 'llvm'
  | 'keil-armclang'
  | 'iar-arm'
  | 'unknown';

interface BuildArtifactSet {
  executablePath?: string;
  mapPath?: string;
  linkerScriptPaths: string[];
  workspaceFolder?: string;
}

interface DetectionEvidence {
  source: 'file-content' | 'elf-metadata' | 'file-name' | 'configured-tool' | 'available-tool';
  description: string;
  weight: number;
}

interface ToolchainDetection {
  toolchainId: ToolchainId;
  confidence: number;
  evidence: DetectionEvidence[];
  diagnostics: AnalysisDiagnostic[];
}

interface ToolchainDetector {
  readonly toolchainId: ToolchainId;
  detect(artifacts: BuildArtifactSet, signal?: AbortSignal): Promise<ToolchainDetection | null>;
}

interface ToolchainAdapter {
  readonly toolchainId: ToolchainId;
  validateEnvironment(
    artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<EnvironmentValidation>;
  analyze(
    artifacts: BuildArtifactSet,
    signal?: AbortSignal
  ): Promise<BuildAnalysis>;
}

type BuildAnalysisResult =
  | { status: 'success'; detection: ToolchainDetection; analysis: BuildAnalysis; diagnostics: AnalysisDiagnostic[] }
  | { status: 'partial'; detection: ToolchainDetection; analysis: BuildAnalysis; diagnostics: AnalysisDiagnostic[] }
  | { status: 'unsupported'; detection: ToolchainDetection; diagnostics: AnalysisDiagnostic[] }
  | { status: 'unknown'; detections: ToolchainDetection[]; diagnostics: AnalysisDiagnostic[] }
  | { status: 'ambiguous'; detections: ToolchainDetection[]; diagnostics: AnalysisDiagnostic[] }
  | { status: 'invalid'; diagnostics: AnalysisDiagnostic[] }
  | { status: 'cancelled'; diagnostics: AnalysisDiagnostic[] };
```

The common `BuildAnalysis` should contain regions, sections, symbols, toolchain metadata, provenance, and warnings. Numeric fields must state their meaning consistently; unknown values must not be represented as zero.

### 4.4 Detection strategy

Detection should use strongest evidence first:

1. identifiable MAP-file headers, syntax, and producer markers;
2. ELF metadata, comments, attributes, machine architecture, and producer information where available;
3. configured executable/tool names;
4. available inspection binaries;
5. artifact filenames only as weak supporting evidence.

The presence of `arm-none-eabi-objdump` on `PATH` must not by itself prove that an artifact was produced by GNU Arm. Detection must not execute an artifact.

The first phase must recognize at least the following families sufficiently to report them as unsupported:

- LLVM/Clang;
- Keil/Arm Compiler (`armcc` or `armclang`/`armlink`);
- IAR Embedded Workbench;
- GNU RISC-V;
- GNU Xtensa.

Recognition may initially rely on documented MAP headers and synthetic fixtures, but all evidence and limitations must be documented.

### 4.5 Adapter registry and orchestration

The registry maps `ToolchainId` to an implemented adapter. In Phase 1 it contains only `gnu-arm-none-eabi`.

The orchestrator must:

1. validate the artifact set;
2. ask all registered detectors for evidence;
3. rank results deterministically;
4. return `unknown` or `ambiguous` rather than guessing;
5. return `unsupported` when a known toolchain has no adapter;
6. validate required tools for a supported adapter;
7. run the adapter;
8. preserve cancellation behavior and structured diagnostics;
9. map successful/partial results to the existing UI model.

### 4.6 Error and diagnostic model

Diagnostics need stable codes so UI and tests do not assert entire English strings. Suggested examples:

- `ARTIFACT_MISSING`;
- `ARTIFACT_UNREADABLE`;
- `TOOLCHAIN_UNKNOWN`;
- `TOOLCHAIN_AMBIGUOUS`;
- `TOOLCHAIN_UNSUPPORTED`;
- `REQUIRED_TOOL_MISSING`;
- `MAP_FORMAT_UNSUPPORTED`;
- `TOOL_EXECUTION_FAILED`;
- `ANALYSIS_PARTIAL`;
- `ANALYSIS_CANCELLED`.

Each diagnostic should include severity, human-readable message, optional toolchain ID, artifact path, underlying cause, and remediation guidance.

For a detected but unsupported toolchain, the analysis area should show, for example:

> Detected IAR Arm toolchain. Analysis for this toolchain is not supported yet. Existing build artifacts were not modified.

## 5. Fixture and test architecture

### 5.1 Principles

- No supported adapter is complete without fixtures and automated tests.
- Tests must not depend on a globally installed cross-toolchain.
- Tests must never execute fixture binaries.
- Proprietary artifacts must not be committed unless redistribution rights are clear.
- Synthetic files must identify their source documentation and limitations.
- Real artifacts should eventually replace or supplement synthetic fixtures.
- Adding a valid fixture case must automatically add it to parameterized tests.
- Malformed or intentionally incomplete files belong in explicitly named negative cases.

### 5.2 Required fixture layout

```text
src/test/fixtures/toolchains/
  gnu-arm-none-eabi/
    synthetic-minimal/
      fixture.json
      firmware.map
      objdump-sections.txt
      nm-symbols.txt
      expected-analysis.json
    real-stm32-sample/
      fixture.json
      firmware.elf
      firmware.map
      expected-analysis.json
  llvm/
    synthetic-detection/
      fixture.json
      firmware.map
      expected-detection.json
  keil-armclang/
    synthetic-detection/
      fixture.json
      firmware.map
      expected-detection.json
  iar-arm/
    synthetic-detection/
      fixture.json
      firmware.map
      expected-detection.json
  gnu-riscv-none-elf/
    synthetic-detection/
      fixture.json
      firmware.map
      expected-detection.json
  gnu-xtensa-elf/
    synthetic-detection/
      fixture.json
      firmware.map
      expected-detection.json
```

Every immediate case directory under a toolchain folder must contain `fixture.json`. A fixture loader must recursively discover all manifests. Tests must fail if:

- a file exists in a case directory but is not declared or explicitly ignored by its manifest;
- a declared input is missing;
- two fixtures have the same ID;
- the declared toolchain differs from the parent toolchain directory;
- a success fixture has no expected analysis;
- a detection fixture has no expected detection result;
- an unknown fixture type is used.

This rule satisfies the requirement that all existing and newly added fixture files are accounted for by tests. It avoids silently treating documentation or expected-output files as analyzer inputs.

### 5.3 Suggested fixture manifest

```json
{
  "schemaVersion": 1,
  "id": "gnu-arm-synthetic-minimal",
  "toolchain": "gnu-arm-none-eabi",
  "kind": "analysis",
  "origin": {
    "type": "synthetic",
    "documentation": [
      "GNU ld map output documentation",
      "GNU objdump documentation",
      "GNU nm documentation"
    ],
    "notes": "Replace or supplement with a reproducible real artifact when available."
  },
  "inputs": {
    "map": "firmware.map",
    "objdumpStdout": "objdump-sections.txt",
    "nmStdout": "nm-symbols.txt"
  },
  "expected": "expected-analysis.json"
}
```

For real fixtures, record compiler/linker version, target architecture, build flags, source license, artifact license, provenance, and a reproducible generation command or project reference.

### 5.4 Fixture generation and acquisition policy

Use this order:

1. Build a tiny permissively licensed program with a locally or CI-available toolchain.
2. Obtain artifacts from an official, redistributable example with recorded provenance.
3. Create the smallest synthetic textual output based on primary toolchain documentation.

Synthetic outputs must not be presented as proof that the adapter works with a real toolchain. They validate parsing and detection behavior only. At least one reproducible real fixture is required before an adapter is described as production-supported.

Large binary artifacts should be kept minimal. If repository policy later uses Git LFS, document it before adding large files.

### 5.5 Test layers

Each phase should include the relevant layers:

1. **Contract tests**: every adapter satisfies shared behavior.
2. **Detector unit tests**: positive, negative, weak evidence, conflicting evidence, truncated input, cancellation.
3. **Parser unit tests**: valid, malformed, empty, overflow/boundary values, unusual region names, missing optional data.
4. **Tool resolver/runner tests**: configured path, `PATH` fallback, Windows suffix, missing binary, non-zero exit, timeout, output limit, cancellation.
5. **Fixture conformance tests**: recursively load and execute every manifest.
6. **Orchestrator integration tests**: supported, unsupported, unknown, ambiguous, invalid, partial and cancelled results.
7. **UI/view-model tests**: status and diagnostic mapping, especially unsupported-toolchain output.
8. **Regression tests**: preserve existing GNU Arm results and issue-specific behavior such as safe ELF copying on Windows.
9. **Extension smoke tests**: activation, commands, configuration changes, and refresh behavior.

Tests should prefer semantic assertions. Snapshot files may supplement but must not replace assertions for critical numeric and status fields.

## 6. Delivery workflow and approval gates

For every numbered implementation step:

1. The agent restates the step scope and lists expected files/tests.
2. The agent implements only that step.
3. The agent runs the narrow tests first, then the full project verification suite.
4. The agent reports changed files, design decisions, test commands/results, remaining risks, and proposed next step.
5. The agent stops and asks for explicit approval.
6. The next step begins only after approval.

The agent must not combine steps merely because the changes are related. If a step exposes a necessary architectural change outside its scope, it must report the blocker and propose a plan adjustment.

Each completed step should be suitable for a focused Git commit. The user decides whether and when to commit or push unless explicitly delegating that action.

## 7. Implementation phases and milestones

## Phase 0 — Baseline and test inventory

### Step 0.1: Establish the behavioral baseline

**Goal:** prove the current state before refactoring.

Actions:

- install dependencies and run compilation, lint, unit tests, extension tests, and packaging where supported;
- inventory current `MapElfParser`, toolchain resolution, discovery, errors, UI mapping, and tests;
- identify observable GNU Arm behaviors that must remain unchanged;
- document current failures or environment-dependent tests without fixing unrelated defects;
- record sample current analysis results as semantic regression expectations.

Acceptance criteria:

- baseline commands and results are documented;
- current failures are distinguished from new regressions;
- no production behavior is intentionally changed;
- the user approves the baseline before architectural work.

### Step 0.2: Introduce fixture conventions and loader

**Goal:** create the scalable fixture mechanism before migrating the parser.

Actions:

- create the toolchain fixture root and documented manifest schema;
- implement recursive discovery and validation;
- add minimal GNU Arm synthetic cases based on current test data;
- add fixture-structure tests ensuring every case and file is accounted for;
- keep existing tests until their replacement coverage is demonstrated.

Acceptance criteria:

- adding a valid manifest directory automatically adds a test case;
- undeclared files and malformed manifests fail clearly;
- tests do not require an installed cross-toolchain;
- all fixture provenance is recorded.

## Phase 1 — Adapter architecture with GNU Arm only

### Step 1.1: Add common contracts and structured diagnostics

**Goal:** define stable boundaries without moving parser behavior yet.

Actions:

- add artifact, detection, adapter, analysis-result, provenance, environment-validation, and diagnostic contracts;
- define stable diagnostic codes;
- add contract/type tests where runtime behavior exists;
- document null/unknown numeric semantics.

Acceptance criteria:

- contracts compile under strict TypeScript settings;
- no current user path changes;
- contracts can express success, partial, unsupported, unknown, ambiguous, invalid, and cancelled states.

### Step 1.2: Extract process execution and tool resolution

**Goal:** remove native-process concerns from the parser.

Actions:

- extract the current spawning, timeout, buffer, cancellation, executable suffix, configured-directory and `PATH` fallback logic;
- preserve Windows safe-copy behavior at the appropriate analysis boundary;
- inject the runner/resolver into adapters;
- retain or improve existing error details through structured diagnostics.

Acceptance criteria:

- no parser owns generic process-spawning code;
- missing tools and execution failures are independently testable;
- existing runner, timeout, cancellation, and fallback behavior remains covered.

### Step 1.3: Extract GNU parsers and implement `GnuArmAdapter`

**Goal:** move current behavior behind the adapter contract without changing results.

Actions:

- separate GNU linker MAP parsing from objdump/nm output parsing;
- implement `GnuArmAdapter` using injected services;
- preserve partial analysis when `nm` fails but memory data is available;
- migrate existing parser tests and fixture cases;
- keep a temporary compatibility facade if needed by the current provider.

Acceptance criteria:

- existing GNU Arm fixtures produce equivalent region, section, symbol and source-link data;
- `MapElfParser` is removed or reduced to a deprecated compatibility facade with no independent logic;
- all previous GNU Arm regression tests pass.

### Step 1.4: Implement detectors and detection registry

**Goal:** detect GNU Arm and recognize known unsupported toolchain families.

Actions:

- implement evidence-based detectors;
- add synthetic detection fixtures for LLVM, Keil, IAR, GNU RISC-V, and GNU Xtensa;
- implement deterministic scoring and ambiguity handling;
- ensure tool availability is supporting, not decisive, evidence;
- expose evidence in debug diagnostics.

Acceptance criteria:

- GNU Arm fixtures select `gnu-arm-none-eabi`;
- known non-GNU-Arm fixtures produce their correct toolchain ID;
- weak or conflicting fixtures return unknown/ambiguous rather than GNU Arm;
- every detector is exercised by positive and negative fixture cases.

### Step 1.5: Implement orchestrator and unsupported results

**Goal:** connect detection to the single implemented adapter.

Actions:

- implement registry selection and orchestration;
- return structured `unsupported` for recognized toolchains without adapters;
- return structured `unknown` and `ambiguous` results;
- validate GNU Arm environment only after selecting its adapter;
- preserve cancellation and partial-analysis behavior.

Acceptance criteria:

- only GNU Arm can reach analysis in this phase;
- Keil, IAR, LLVM, RISC-V, and Xtensa never fall through to GNU Arm tools;
- unsupported results include toolchain name, reason, and remediation/status message;
- orchestrator branch coverage includes every result status.

### Step 1.6: Integrate with provider and UI

**Goal:** use the orchestrator in the extension while preserving existing users.

Actions:

- route current build pairs through `BuildArtifactSet` and the orchestrator;
- map success/partial results to the current display;
- render unsupported, unknown, ambiguous, invalid, missing-tool and cancelled states clearly;
- retain existing commands and settings;
- remove temporary compatibility code only when unused and fully covered.

Acceptance criteria:

- an existing STM32/GNU Arm project works as before;
- a detected unsupported fixture produces a visible non-crashing result;
- settings changes and file watching still refresh analysis;
- extension smoke tests and full suite pass.

### Step 1.7: Phase 1 hardening and documentation

**Goal:** declare the adapter foundation ready for additional toolchains.

Actions:

- run full lint, compile, tests and VSIX packaging;
- audit unhandled exceptions and logs for legacy STM32-specific parser assumptions;
- document supported/recognized/unknown toolchain behavior;
- document how to add an adapter and fixture;
- manually verify one real STM32 build if an artifact is available.

Phase 1 milestone:

- architecture is adapter-based;
- toolchain detection is active;
- GNU Arm is the only supported adapter;
- all other recognized families return explicit unsupported results;
- current users and configuration remain compatible;
- approval is required before Phase 2.

## Phase 2 — Generic GNU/binutils foundation and GNU RISC-V

Add toolchains one at a time even when they share implementation.

### Step 2.1: Extract reusable GNU/binutils components

- generalize executable names and target metadata without changing GNU Arm behavior;
- retain `GnuArmAdapter` as a concrete adapter, not a conditional mega-adapter;
- add shared GNU adapter contract tests.

### Step 2.2: Add GNU RISC-V adapter

- research primary GNU/RISC-V documentation;
- obtain or generate synthetic and real minimal fixtures;
- support configurable/discovered `riscv-none-elf-*` variants;
- verify machine architecture and region/section/symbol results;
- update the support matrix only after real-fixture verification.

Milestone: GNU RISC-V changes from recognized/unsupported to supported.

## Phase 3 — GNU Xtensa / ESP32

### Step 3.1: Add GNU Xtensa adapter

- distinguish common Xtensa prefixes and ESP-IDF outputs;
- research ESP32 MAP/ELF variations;
- add separate fixtures for materially different targets if necessary;
- avoid calling all ESP-IDF configurations supported until tested.

Milestone: documented Xtensa variants move to supported; unverified variants remain explicitly unsupported.

## Phase 4 — LLVM embedded

### Step 4.1: Add LLVM adapter

- use `llvm-objdump`, `llvm-nm`, or a library-backed ELF reader as justified by an approved design note;
- define compatible MAP formats rather than assuming all lld outputs match GNU ld;
- add real Clang/lld embedded artifacts plus documented synthetic edge cases;
- test mixed environments where both GNU and LLVM tools are installed.

Milestone: verified Clang/lld embedded outputs move to supported.

## Phase 5 — Keil Arm Compiler

### Step 5.1: Add Keil/ArmClang adapter

- treat AXF as ELF only when verified;
- parse supported `armlink` MAP/report formats or invoke user-installed `fromelf` where licensing permits;
- never package proprietary tools;
- distinguish Arm Compiler 5 and Arm Compiler 6 if outputs differ materially;
- add redistributable real fixtures or keep support experimental.

Milestone: explicitly listed Keil versions/formats move to supported.

## Phase 6 — IAR Arm

### Step 6.1: Add IAR adapter

- research IAR ELF/DWARF and MAP formats from primary documentation;
- use user-installed inspection tools only when necessary and permitted;
- separate IAR version variants when formats differ;
- include redistribution and provenance review for fixtures.

Milestone: explicitly verified IAR versions/formats move to supported.

## Phase 7 — Extensibility and optional plugin API

Only after at least three adapters validate the abstraction:

- review whether the adapter interface is genuinely stable;
- consider external adapter registration;
- version the adapter API;
- add compatibility tests and adapter author documentation;
- define security/trust constraints for external executables and third-party adapters.

Do not publish a plugin API prematurely based on the first adapter alone.

## Phase 8 — Pre-release validation under the current identity

Prepare and distribute a test release before changing the product name:

- retain `STM32 Build Analyzer (Enhanced)` as the display name and preserve all
  existing Marketplace, command, view, and configuration identifiers;
- use Marketplace pre-release version `1.2.0`, packaged and published with
  `vsce --pre-release`; reserve `1.2.1` for the subsequent stable release;
- update the manifest, lockfile, changelog, README, release notes, support
  matrix, and manual test checklist;
- distinguish verified real-artifact support from synthetic/experimental
  format coverage and avoid universal toolchain claims;
- run the complete automated release checks and test the packaged VSIX on the
  supported host platforms before publishing;
- collect compatibility feedback without changing persisted identifiers or
  introducing migration behavior.

Milestone: an installable `1.2.0` pre-release candidate is ready for opt-in
testing under the current extension identity.

## Phase 9 — Rebranding and Marketplace migration

After the architecture and support claims are verified:

- change only user-facing `displayName`, descriptions, commands labels, imagery, and README positioning;
- retain the existing Marketplace identity and legacy configuration IDs;
- publish an accurate support matrix;
- use a transitional label such as `Embedded Build Analyzer – STM32, ELF & MAP`;
- state "formerly STM32 Build Analyzer (Enhanced)" for several releases;
- do not claim "any toolchain"; say "adapter-based" and list verified toolchains.

## 8. Definition of done for every new adapter

An adapter is not done until all conditions are met:

- primary documentation and format assumptions are recorded;
- detector has positive, negative, ambiguous, and malformed-input tests;
- adapter passes shared contract tests;
- synthetic fixtures cover parser edge cases;
- at least one legally redistributable, reproducible real artifact verifies end-to-end behavior;
- every fixture file is declared and automatically exercised;
- missing tools, tool failure, timeout, cancellation and partial data are tested;
- UI displays success and failure states correctly;
- support matrix names exact supported variants;
- full project test, lint, compile and package commands pass;
- user approves the adapter before work begins on the next one.

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Detection produces false positives | Weighted evidence, ambiguity outcome, fixtures from competing formats |
| Adapter abstraction follows GNU assumptions | Validate with multiple adapters before freezing/publicizing API |
| Synthetic fixtures diverge from reality | Label provenance; require a real reproducible artifact before production support |
| Proprietary fixture licensing | Use minimal synthetic text or user-generated artifacts with explicit rights |
| Refactor breaks current STM32 users | Baseline regression fixtures, compatibility facade, unchanged IDs/settings |
| Installed tools influence tests | Inject runner/resolver; use captured stdout fixtures |
| Tool versions change textual output | Version fixtures and use tolerant parsers with semantic assertions |
| Large fixture repository | Minimal programs/artifacts, documented generation, optional future Git LFS policy |
| One mega-adapter accumulates conditionals | Concrete adapters over shared utilities; shared contract tests |
| Unsupported toolchain silently uses wrong tools | Registry gate; only exact supported adapter may analyze |

## 10. Coding-agent prompt for starting the implementation

Copy the prompt below into the coding agent while the repository root is open. It starts only Phase 0, Step 0.1. After the agent reports its results, approve or revise that step before asking it to continue with Step 0.2.

---

### Prompt

You are working in the `stm32-build-analyzer` VS Code extension repository.

Read `docs/embedded-build-analyzer-implementation-plan.md` completely before making changes. Treat it as the authoritative architecture, testing, compatibility, fixture, and delivery plan for this task. Also read and follow any repository `AGENTS.md` files and existing contribution instructions.

## Overall objective

Refactor the extension into an adapter-based Embedded Build Analyzer with automatic evidence-based toolchain detection. During the first architecture phase, GNU Arm Embedded (`arm-none-eabi`) must remain the only supported analysis adapter. Recognized LLVM, Keil/ArmClang, IAR Arm, GNU RISC-V, and GNU Xtensa artifacts must produce explicit structured `unsupported` analysis results. Unknown or ambiguous artifacts must never be guessed as GNU Arm.

Maintain backward compatibility with the existing extension identity, command IDs, settings keys, build-pair discovery, file watching, and GNU Arm analysis behavior. Cover the implementation comprehensively with tests. Toolchain test artifacts must live in separate toolchain/case subfolders and be discovered recursively so all complete existing and newly added fixture cases are tested automatically. Synthetic outputs must record documentation provenance and be replaceable by real outputs later.

## Mandatory incremental workflow

Implement exactly one numbered step from the plan at a time.

For each step:

1. Restate the exact step and scope before editing.
2. Inspect the relevant existing code and tests.
3. List the files you expect to add or change and the verification commands you intend to run.
4. Implement only the approved step. Do not begin preparatory implementation for later steps.
5. Add or update tests required by that step.
6. Run focused tests first and then the complete applicable verification suite.
7. Report:
   - files changed;
   - behavior and architecture decisions;
   - tests added;
   - exact commands and summarized results;
   - compatibility impact;
   - limitations, risks, or blockers;
   - the proposed scope of the next numbered step.
8. Stop and wait for my explicit approval before modifying code for the next step.

Do not combine steps, silently expand scope, commit, push, publish, change Marketplace identity, or rename existing configuration/command IDs without explicit approval. Do not fix unrelated issues unless they block the approved step; report blockers first.

## Current approved work: Phase 0, Step 0.1 only

Establish and document the current behavioral baseline. Do not introduce the adapter architecture yet.

Required work:

- inspect the repository structure, `package.json` scripts, current parser, toolchain resolution, discovery, provider/UI integration, and relevant tests;
- install dependencies only if necessary and allowed by the environment;
- run the existing compile, lint, unit/integration tests, extension tests, and VSIX packaging commands where supported;
- record exact commands, pass/fail counts, environment-dependent limitations, and existing failures;
- identify current externally observable GNU Arm behavior that later steps must preserve, including:
  - MAP/ELF pair selection;
  - GNU linker `Memory Configuration` parsing;
  - region, section and symbol mapping;
  - source navigation information;
  - missing-tool fallback and errors;
  - partial results when `nm` fails;
  - cancellation, timeout and output-size handling;
  - temporary ELF-copy behavior;
  - refresh and file-watching behavior;
- create or update a concise baseline document under `docs/` if no suitable document exists;
- make no intentional production-code behavior changes in this step;
- if a documentation-only or test-only correction is required to capture the baseline, explain it before editing.

Completion criteria:

- baseline results are reproducible and documented;
- pre-existing failures are clearly separated from regressions;
- no adapter/refactor production code has been introduced;
- no existing identifiers or behavior have been intentionally changed;
- you provide the required report and stop for approval before Step 0.2.

Begin by reading the plan and inspecting the repository. Then restate Step 0.1 and your proposed verification commands. Do not edit anything until you have presented that initial Step 0.1 assessment.

---

## 11. Follow-up prompt pattern after approving a step

Use this short prompt after reviewing each agent report:

```text
I approve Phase X, Step X.Y as reported. Implement Phase X, Step X.Z only, following the incremental workflow and acceptance criteria in docs/embedded-build-analyzer-implementation-plan.md. Add the required tests, run focused and full verification, report the evidence, and stop for approval before continuing.
```

If changes are required before approval:

```text
Phase X, Step X.Y is not approved yet. Address only the following review findings, rerun the affected and full verification suites, report the updated evidence, and stop again: [findings]. Do not start the next step.
```
