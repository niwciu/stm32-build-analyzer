# STM32 Build Analyzer (Enhanced) 🚀  
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue?logo=visualstudiocode)](#)

> Visual memory analyzer for STM32 projects – works with `.map` and `.elf` files, no matter what toolchain or build system you use.

![Main UI View](images/2.JPG)

---

## ❓ Why This Fork?

The original version was depandet with cmake-tool extension.  
This fork removes that dependency, adds broader file handling, and enhances the UI for developers using VSCode, CMake, Makefiles, or any other custom setups.

---

## 🚀 Key Improvements in This Fork

✅ **Removed CMake dependency** – Works with any build system (Makefile, CubeIDE, etc.)  
✅ **Custom build folder support** – Easily set via UI button or command  
✅ **Improved file discovery** – More robust handling of `.map` and `.elf` files, multi build folders handling,   
✅ **Optimized UI** – Visual memory usage indicators, serach option and sortable symbol view  

---

## 🔍 Features

- Memory region analysis using `.map` and `.elf` files
- Detailed breakdown of memory sections and symbols
- Clickable links from symbols to source files
- Visual panel with color-coded usage (RAM, Flash)
- Sorting by symbol name/address/size within each section
- Search filter for regions/sections/symbols with optional case sensitivity
- ARM toolchain integration (`arm-none-eabi-objdump`, `nm`)
- Compatible with any build system
- Build multiple folders auto detection
- Option to point manualy to map and elf object (even wihout .elf .map extension)

---

## 📦 Installation

### From VS Code Marketplace

📥 [Marketplace link placeholder](https://marketplace.visualstudio.com/items?itemName=niwciu.stm32-build-analyzer-enhanced#)

### Manual Installation

#### Requirements

1. Node.js installed  
2. npm installed  
3. `vsce` installed:
   ```bash
   npm install -g @vscode/vsce
   ```

#### Build and Install manual
1. Clone the repository:
   ```bash
   git clone https://github.com/niwciu/stm32-build-analyzer.git
   cd stm32-build-analyzer
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the .vsix package using vsce:
   ```bash
   vsce package
   ```
4. This will generate a file like: `stm32-build-analyzer-enhanced-1.1.5.vsix`

5. Install the extension in VS Code: 
   ```bash
   code --install-extension stm32-build-analyzer-enhanced-1.1.5.vsix
   ```


---

## 🛠 Usage

- Open the Command Palette (`Ctrl+Shift+P`) and run:
  - `STM32 Build Analyzer` – opens the main view
  - `STM32 Build Analyzer Refresh Paths` – re-detects build output folder
  - `STM32 Build Analyzer Add Manual Build Pair` – add a manual map/elf pair via prompts
- Analyzer view updates automatically when build output files change.
- Click the button next to **Name**, **Address**, or **Size** headers to sort symbols within a section (click again to toggle ascending/descending).

---

## ⚙️ Configuration

The extension auto-detects `.map` + `.elf` files in common build folders. If your build outputs use different names or the ELF has no extension, configure a manual pair so the analyzer can still select the correct files.

### How auto-detection works

1. If **both** `mapFilePath` and `elfFilePath` are set and point to readable files, the extension uses them directly and skips scanning.
2. Otherwise, it scans the entire workspace (including symlinked directories) and collects any folder containing both `.map` and `.elf` files.
3. If multiple candidates are found, you will be prompted to pick the build output (or a manual pair).

### Toolchain path behavior

When `toolchainPath` is set, the extension uses the `arm-none-eabi-objdump` and `arm-none-eabi-nm` binaries from that directory.  
If it is **not** set (or the binaries are not found), it falls back to using those tools from your system `PATH`.

### Settings reference

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `stm32BuildAnalyzerEnhanced.mapFilePath` | string | `""` | Absolute path to the `.map` file (overrides automatic search). |
| `stm32BuildAnalyzerEnhanced.elfFilePath` | string | `""` | Absolute path to the `.elf` file (overrides automatic search). |
| `stm32BuildAnalyzerEnhanced.toolchainPath` | string | `""` | Absolute path to the ARM GNU Embedded toolchain binaries. |
| `stm32BuildAnalyzerEnhanced.manualBuildPairs` | array | `[]` | List of manual map/elf pairs for builds with non-matching names or locations. |
| `stm32BuildAnalyzerEnhanced.debug` | boolean | `false` | Enable verbose logging for debugging purposes. |

### Manual map/elf pairs

Add one or more entries in **Settings → STM32 Build Analyzer (Enhanced) → Manual Build Pairs**:

```json
"stm32BuildAnalyzerEnhanced.manualBuildPairs": [
  {
    "label": "Release build",
    "folder": "build/Release",
    "map": "firmware.map",
    "elf": "firmware.out"
  }
]
```

Paths can be absolute or relative. `map` and `elf` paths may be relative to the `folder` when provided.

You can also add a manual pair from the Command Palette using **STM32 Build Analyzer Add Manual Build Pair**, which writes a new entry into the settings for you.

---

## 📜 Changelog

See [CHANGELOG.md](CHANGELOG.md) for full version history.

---

## 🤝 Contributing
 
Contributions are welcome! Please fork the repo and submit a pull request:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature-name`)
3. Commit your changes (`git commit -m "Add feature"`)
4. Push to branch (`git push origin feature-name`)
5. Open a Pull Request

If you find bugs or want to request features, feel free to [open an issue](https://github.com/niwciu/stm32-build-analyzer/issues).


---

## ⚖️ License & Attribution

This extension is licensed under the [MIT License](LICENSE).  
Originally created by Aleksei Perevozchikov ([ATwice291](https://github.com/ATwice291))  
Fork maintained by [niwciu](https://github.com/niwciu) with enhancements described above.

---

<!-- SEO note -->
STM32 build analyzer for memory usage, symbol tracking, and map/elf inspection – compatible with Makefiles, CubeIDE, and other toolchains.

## ❤️ Thank you for using this version of STM32 Build Analyzer!

</br></br>
<div align="center">

***

![myEmbeddedWayBanerWhiteSmaller](https://github.com/user-attachments/assets/f4825882-e285-4e02-a75c-68fc86ff5716)
***
</div>
