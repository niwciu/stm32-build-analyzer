# Embedded Build Analyzer migration baseline

This document records Phase 0, Step 0.1 of the adapter-architecture roadmap. It
describes the behavior and verification results observed on 2026-09-16 before
any adapter, detector, fixture-loader, or structured-diagnostic code was added.

## Scope and environment

- Branch: `feature/multi_toolchain`
- Extension: `niwciu.stm32-build-analyzer-enhanced` version `1.1.9`
- Host: Ubuntu Linux, kernel `7.0.0-31-generic`, x86-64
- Node.js: `v22.23.2`
- npm: `10.9.8`
- VS Code test host: `1.138.0`
- Dependency state: `npm ls --depth=0` passed. Existing `node_modules` was used;
  no dependency installation was required.

The working tree already contained an unrelated deletion of
`.claude/settings.json` and the untracked roadmap under `ToDo/`. They were not
modified by this step.

## Verification results

| Command | Result |
| --- | --- |
| `npm ls --depth=0` | Passed; all direct dependencies resolved. |
| `npm run compile-tests` | Passed; strict TypeScript test/application compilation completed with no diagnostics. |
| `npm run compile` | Passed; development extension and webview bundles compiled. |
| `npm run lint` | Passed; ESLint reported no findings in `src` or `webview`. |
| `npm test` | Passed; pretest compilation, bundling, and lint passed, followed by **141 passing**, **0 failing**, **0 skipped** tests in the VS Code extension host. |
| `npm run package` | Passed; minified production extension and webview bundles compiled. |
| `npm run vsix` | Passed; produced `stm32-build-analyzer-enhanced-1.1.9.vsix`, 983.81 KB, containing 18 files. |

No pre-existing test, compile, lint, package, or VSIX failure was observed.
There is therefore no known failing baseline to exempt from later regression
checks.

The first `npm test` invocation downloaded a 328.52 MB VS Code test runtime.
Fresh environments consequently require network access for that invocation.
The extension-host log also contained VS Code-internal unsigned-account/channel
messages and a Node `url.parse()` deprecation warning; these did not affect the
tests. No globally installed GNU Arm toolchain was used, and no real firmware
artifact was analyzed during this baseline run.

## Current responsibility inventory

- `BuildFolderResolver` resolves custom settings, manual pairs, automatic
  discovery, user selection, and the configured toolchain directory.
- `buildDiscovery` recursively discovers matching MAP/ELF outputs independently
  of the build system.
- `MapElfParser` owns GNU linker MAP parsing, GNU `objdump`/`nm` parsing, tool
  resolution, native process execution, limits, cancellation, and temporary ELF
  copying.
- `BuildAnalyzerProvider` coordinates resolution, watching, refresh
  cancellation, parsing, warnings/errors, and rendering.
- `WebviewRenderer` maps the current `Region[]` plus warning strings directly to
  the webview and handles source-navigation messages.
- The current common model contains only regions, sections, and symbols. There
  is no toolchain identity, detection evidence, provenance, structured
  diagnostic, or analysis-status model.

## Behavior that later steps must preserve

### Artifact discovery and pair selection

1. `mapFilePath` and `elfFilePath` have highest priority and must be configured
   together. Both support absolute, workspace-relative, and supported variable
   forms, and both must be readable.
2. Manual pairs may use different MAP and executable basenames and may point to
   an executable with an extension such as `.out`. Incomplete or unresolved
   entries are errors; entries whose outputs have not been built are skipped
   while other manual or automatic choices remain available.
3. Automatic discovery scans every workspace root recursively, ignores
   `node_modules`, `.git`, `.vscode`, `.vscode-test`, and `dist`, does not follow
   directory symlinks, and deduplicates overlapping roots.
4. Automatic pairs require non-empty `.map` and readable `.elf` files in the
   same directory with the same basename. Matching is case-insensitive. The
   current automatic path recognizes `.elf`, not `.out` or extensionless
   executables.
5. Multiple candidates are offered through a quick pick. A previously selected
   pair is reused if still present; cancelling a full reselection restores the
   previous pair without showing an analysis error.

### GNU linker MAP parsing

- Parsing begins only after the exact `Memory Configuration` header and stops
  at the exact `Linker script and memory map` header.
- A region line supplies name, hexadecimal origin, and hexadecimal length.
  Regions start with `used = 0` and no sections.
- Names containing `default`, `catch-all`, or `catchall` case-insensitively, and
  any name wrapped in `*...*`, are excluded as catch-all regions.
- An unreadable or empty MAP, or a MAP without at least one usable GNU memory
  region, produces an actionable error containing the artifact path where
  applicable.

The inline regression sample establishes RAM at `0x20000000` with size
`0x20000` and FLASH at `0x08000000` with size `0x100000`, while excluding
`*default*`.

### Sections, usage, symbols, and source navigation

- `arm-none-eabi-objdump -h` provides sections. Non-empty `ALLOC` sections are
  assigned by VMA to the containing runtime region and increment that region's
  `used` value.
- A section whose LMA differs from VMA is also charged to its load region only
  when its flags include both `LOAD` and `CONTENTS`. Consequently initialized
  RAM content is represented in RAM at runtime and FLASH as a load image, while
  BSS/NOLOAD-style content is not charged to FLASH.
- If `objdump` succeeds but no allocatable section matches any MAP region, the
  pair is rejected as potentially inconsistent.
- The section regression sample assigns `.ramfunc` (`0x20` bytes) and
  `.data.extra` (`0x10` bytes) to both RAM and FLASH, producing `used = 0x30` in
  each. The BSS sample assigns `0x60` bytes to RAM and zero bytes to FLASH.
- `arm-none-eabi-nm -C -S -n -l --defined-only` supplies demangled symbol name,
  address, optional size, and optional `path:line`. A symbol is attached only
  when its address belongs to both a known region and one of that region's
  sections.
- Relative source paths are resolved against the original ELF directory;
  absolute paths are normalized and retained. Names and source paths containing
  spaces, as well as LF and CRLF tool output, are supported. Missing source
  information is represented as an empty path and row zero.
- The webview sends a symbol's stored path and one-based row back to the
  extension; the renderer opens the document and reveals that line.

### Tool resolution and execution

- The required tools are hard-coded as `arm-none-eabi-objdump` and
  `arm-none-eabi-nm`; Windows adds `.exe` when checking a configured directory.
- An existing configured binary is used. If an individual binary is absent,
  execution falls back to its bare name on `PATH`; the provider warns once for
  missing configured binaries. A missing or unresolved configured directory
  also warns and falls back to `PATH`.
- Tool failures include the tool, resolved command, spawn/exit reason, up to 500
  normalized characters of stderr, and guidance to install the tool or correct
  `stm32BuildAnalyzerEnhanced.toolchainPath`.
- Native processes have a 30-second timeout. Captured output is limited to 8 MiB
  for `objdump` and 32 MiB for `nm`; stdout and stderr are bounded independently.
  Timeout, excess output, and refresh cancellation kill the child process.
- Cancellation uses `AnalysisCancelledError`. Starting a newer refresh aborts
  the older one, and the superseded refresh publishes neither stale data nor
  errors/warnings.
- Failure of `nm` alone is partial success: region and section usage remains
  available and a warning says that symbol/source details are incomplete.
  Failure of `objdump` fails the analysis.

### Temporary ELF handling

Before invoking either tool, the parser reads the ELF and writes it to a new
temporary directory. Both tools receive the copy, which is removed after
success or failure; the original remains untouched. This protects rebuilds on
Windows from tool-held handles (issue #11). If copying fails, analysis falls
back to the original ELF path and still attempts cleanup.

### Refresh, watching, and presentation

- Discovery watchers observe MAP and ELF create/change/delete events throughout
  the workspace. Selected-file watchers observe exact selected MAP and
  executable paths, including manual `.out` or extensionless outputs. Events
  are debounced for 300 ms.
- Build-path setting changes and workspace-folder changes invalidate cached
  paths. A toolchain-only setting change retains the selected build pair and
  resolves only the toolchain path again. Granting workspace trust triggers a
  fresh resolution; analysis is blocked while the workspace is untrusted.
- Successful analysis sends `Region[]`, the relative build directory, and
  warning strings to the webview. Failure clears transient webview state, shows
  an error in the webview, and displays a de-duplicated VS Code error message.
- Existing extension identity, command IDs, view IDs, and all
  `stm32BuildAnalyzerEnhanced.*` setting keys are part of this compatibility
  baseline.

## Baseline limitations and migration risks

- Every selected artifact is assumed to be GNU Arm; no detection prevents a
  foreign toolchain from reaching GNU Arm tools.
- Process execution, tool resolution, MAP parsing, binutils parsing, temporary
  copying, and partial-result policy are coupled in `MapElfParser`.
- Tests use inline synthetic MAP and captured tool text. There is no recursive
  fixture manifest, provenance record, shared adapter contract, or reproducible
  real-artifact end-to-end test.
- No test in this baseline proves compatibility with a locally installed GNU
  Arm release. Synthetic parser coverage must not be presented as that proof.
- Error and warning behavior is string-based. The UI cannot distinguish
  unsupported, unknown, ambiguous, invalid, cancelled, or partial states through
  a stable status/diagnostic contract.
- Numeric parsing uses JavaScript `number` and `parseInt`; unknown symbol size
  and source row currently collapse to zero, and overflow/boundary semantics are
  not explicitly tested.
- Most tests run inside the downloaded VS Code extension host, so the current
  `npm test` is an integration-style suite rather than a lightweight standalone
  unit command.

## Step conclusion

Phase 0, Step 0.1 changes documentation only. It introduces no production-code
or test behavior change and establishes a green baseline for comparison. Phase
0, Step 0.2 (fixture conventions and recursive loader) must not begin until this
baseline is explicitly approved.
