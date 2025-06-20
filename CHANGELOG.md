# Changelog

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