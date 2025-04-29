# STM32 Build Analyzer (Enhanced)

**Community-maintained fork of [ATwice291/stm32-build-analyzer](https://github.com/ATwice291/stm32-build-analyzer)**  
*Original version by Aleksei Perevozchikov (ATwice291), licensed under MIT.*

![Main view](images/2.JPG)

## Key Improvements in This Fork

✅ **Removed CMake dependency** - Works with any build system  
✅ **Custom build folder support** - Configure your build directory in settings  
✅ **Improved file discovery** - Better handling of .map/.elf files  
✅ **Optimized UI** - Enhanced memory visualization  

## Features

- Memory region analysis from linker map files
- Detailed section/symbol breakdown with source code links
- Visual memory usage indicators (color-coded thresholds)
- Support for all STM32 projects (not limited to CMake)
- ARM toolchain integration (`arm-none-eabi-objdump`, `arm-none-eabi-nm`)

## Installation

1. Install from [VS Code Marketplace](LINK_TO_YOUR_EXTENSION)  
   or  
   ```bash
   code --install-extension stm32-build-analyzer-enhanced-*.vsix

## Features

* Custom bottom-panel webview.
* Memory region analysis from .map files.
* Displays detailed memory usage, including sections and their sizes.
* Compatible with any STM32-based project.
* Symbols have links to source code.


### 1.0.0

Initial STM32 Build Analyzer plugin release

### 1.0.2

Added icons and indents

### 1.0.3

- arm-none-eabi-objdump and arm-none-eabi-nm are used to get more accurate results
- symbols now have links to source code

### 1.0.4
- fixed a bug causing incorrect operations with sectors at address 0x00000000 (e.g., ITCMRAM)

### 1.0.5
- the plugin worked only with the 'Debug' build type - fixed. now the plugin gets the build type name from the CMake Tools extension

## License

This extension is licensed under the [MIT License](LICENSE).