# Changelog
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
