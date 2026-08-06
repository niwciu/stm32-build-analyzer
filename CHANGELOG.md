# Changelog
## [1.1.7] – 2026-08-04

### Fixed
- Pass the resolved `toolchainPath` to the ELF parser so workspace-relative paths and `${userHome}`, `${workspaceFolder}`, and `${env:VAR}` variables work end to end.
- Resolve named multi-root workspace variables such as `${workspaceFolder:Toolchain}` in toolchain, MAP, and ELF paths.
- Pair automatically discovered MAP and ELF files by basename so outputs from different targets are never combined silently.
- Count every initialized RAM section with a distinct ELF load image in both its runtime region and its Flash load region, rather than special-casing only `.data`.
- Clear stale analysis results after a failed refresh and show the failure persistently inside the webview.
- Reject empty, unreadable, or unsupported MAP files with an actionable error that identifies the selected file.
- Preserve valid memory-region usage when `nm` fails and label symbol/source data as incomplete inside the webview; `objdump` remains required.
- Watch the exact selected MAP and ELF paths, including `.out` and extensionless manual outputs, and detect case variations of automatic `.map`/`.elf` files.
- Preserve demangled symbol names and source paths containing spaces, and resolve relative source paths from the original ELF directory.
- Run recursive build discovery with asynchronous filesystem operations and skip directory symlinks and tooling/dependency output folders.
- Run `objdump` and `nm` asynchronously with bounded output and a 30-second timeout so analysis cannot indefinitely block the extension host.
- Synchronize selected webview rows by exact key comparison instead of embedding ELF-derived text in CSS selectors.
- Scan every root in multi-root workspaces, deduplicate overlapping roots, resolve variables in manual pairs, and display paths relative to the owning workspace folder.
- Report unset environment variables and unknown workspace-folder variables explicitly instead of silently replacing them or redirecting relative paths.
- Render zero-sized or malformed memory regions with a finite percentage and clamp visual progress bars without hiding over-capacity usage.
- Check every occurrence during whole-word symbol search instead of rejecting a row when only its first occurrence is embedded in another identifier.
- Treat build-output Quick Pick cancellation as a user action, keep the previous selection, and avoid showing an error.
- Keep rows only for the active webview table instead of building duplicate DOM trees for large symbol sets.
- Generate webview Content Security Policy nonces from cryptographically secure random bytes.
- Include webview TypeScript in the standard lint command.
- Add CI for extension-host tests, linting/compilation, runtime dependency audit, production bundling, and VSIX content validation.
- Replace the vulnerable VS Code test CLI dependency with a direct `@vscode/test-electron` runner and patched Mocha dependency chain.
- Disable production source maps and exclude any stale map artifacts from packaged VSIX files.
- Cancel superseded filesystem discovery and native tool processes when a newer refresh starts.
- Apply changes to toolchain, map, ELF, and manual-pair settings without requiring a VS Code window reload.
- Reset tool discovery to `PATH` when `toolchainPath` is cleared.
- Show actionable errors when `objdump` or `nm` cannot run or exits unsuccessfully instead of silently rendering `0 B` memory usage.
- Warn when a configured toolchain directory is missing required binaries while preserving per-tool fallback to `PATH`.
- Reject mismatched map/ELF pairs when no allocatable ELF sections match the map memory regions.

### Changed
- Disable native tool execution in untrusted workspaces and mark `toolchainPath` as a restricted workspace setting.
- Debug logging configuration now takes effect without reloading the extension.
- Added regression coverage for resolved toolchain wiring, tool fallback, execution failures, and required binary validation.
- Corrected VSIX contents so compiled entry points and view icons are included while development-only files and dependencies are excluded.

## [1.1.6] – 2026-06-06

### Added
- Variable resolution support (`${userHome}`, `${env:VAR}`, `${workspaceFolder}`) in `toolchainPath`, `mapFilePath`, and `elfFilePath` settings.
- Unit tests for variable expansion, map parsing, command registration, and the ELF-copy analysis path (39 tests total).

### Fixed
- Extension no longer keeps a handle open on the `.elf` file. Section/symbol analysis (`objdump`/`nm`) now runs against a throwaway copy in the system temp directory, so the build's own `.elf` stays handle-free and subsequent builds can delete/overwrite it. Resolves failing rebuilds on Windows (#11).
- `toolchainPath`, `mapFilePath`, and `elfFilePath` now also accept workspace-relative paths.
- Windows path separator bug in toolchain binary resolution.
- Noisy info notification shown on every refresh when `toolchainPath` was configured.

### Changed
- Settings descriptions updated to document variable and relative path support.

## [1.1.5] – 2026-03-08

### Fixed
- Preserve scroll position in the webview table when clicking hyperlinks to open source files.

## [1.1.4] – 2026-01-29

### Added
- Object filtering functionality, including a new selection column and controls to toggle between showing selected objects and all objects.
- Additional combobox for selecting the preferred view.
- New additional table view.

### Changed
- Search functionality extended with advanced options, including whole-word search and regular expression (regex) search.

## [1.1.3] – 2026‑01‑15

### Added
- Manual map/elf pairs (setting + command) for builds with non-matching outputs (including files with no .elf .map extension).
- Symbol sorting controls by name/address/size within sections in the analyzer view.
- Command palette entry to open the analyzer view directly.
- Search box with case-sensitive toggle to filter regions/sections/symbols in the analyzer view.

### Changed
- Auto-detection and toolchainPath behavior documented in README.
- Resolve custom map/elf paths relative to the workspace root when configured in settings.
- Skip common heavyweight folders during build output scanning.
- Debounce map/elf file watcher refreshes to avoid excessive parsing.
- Build output detection now scans the full workspace (including symlinked directories) to find every folder containing both `.map` and `.elf`.
- Quick Pick entries now display build names derived from ELF/MAP filenames with the folder shown on the detail line.

### Fixed
- Not working command palette entries.
- Incorrect configuration namespace usage when resolving map/elf paths.
- Webview template literal escaping issues affecting row selection toggles.
- Allow non-alphanumeric memory region names in map parsing.
- Improve objdump/nm error handling and buffer limits for large outputs.
- Handle demangled symbol names with spaces during nm parsing.
- Skip catch-all/default summary regions when parsing map files.

## [1.1.2] – 2025‑06‑20

### Added
- New `toolchainPath` configuration option allowing users to specify a custom path to the ARM GCC toolchain (e.g., when not available in the system `$PATH`).
- Added `debug` logging option (`stm32BuildAnalyzerEnhanced.debug`) for easier extension troubleshooting.
- Console logs now available via `console.log()` in `Extension Host` output.
- Added log messages to key services (`BuildFolderResolver`, `MapElfParser`, `BuildAnalyzerProvider`) to aid in debugging and development.
- Webview now shows current selected build folder.

### Changed
- Major codebase refactor:
  - Logic split into separate modules (`BuildAnalyzerProvider`, `MapElfParser`, `BuildFolderResolver`, `WebviewRenderer`, `FileWatcherService`).
  - Improves maintainability, readability, and testability.
- Webview now uses proper [Content Security Policy (CSP)](https://aka.ms/vscode-webview-missing-csp) header — removes VS Code security warning.

### Fixed
- Improved error handling when `.map` or `.elf` files are missing — users now see clear error messages.
- Correct handling of file existence using async `fs.promises.access()` instead of sync checks.
- Toolchain path validation and messaging now clearly indicates fallback or missing state.
- Fixed misleading "Build folder selection cancelled" error on first load.
- Fixed: selection of build folder no longer silently fails if workspace folders are not open.



## 1.1.1
- Added info about current selected build folder in consle view

## 1.1.0 (Fork Initial Release)
- Removed mandatory CMake dependency
- Added interactive compile folder switching
- Improved memory usage display and file search
- Updated documentation

## 1.0.5
- Fixed: plugin previously only worked with the 'Debug' build type (CMake)
- Now detects build type name from CMake Tools extension

## 1.0.4
- Fixed sector display bug at 0x00000000 (e.g., ITCMRAM)

## 1.0.3
- Uses `arm-none-eabi-objdump` and `nm` for accurate results
- Symbol names link to source files

## 1.0.2
- UI: Added icons and better indentation

## 1.0.0
- Initial STM32 Build Analyzer release (by ATwice291)
