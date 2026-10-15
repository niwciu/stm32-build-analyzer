# 1.2.0 pre-release checklist

## Version policy

Version `1.2.0` is the opt-in Marketplace pre-release under the existing
`niwciu.stm32-build-analyzer-enhanced` identity and STM32 Build Analyzer
(Enhanced) display name. Package or publish it with `--pre-release`; the
Marketplace does not support `-beta` or `-rc` version suffixes for extensions.
The intended stable successor is `1.2.1`; Marketplace pre-release and stable
uploads cannot reuse the same version.

Creating a VSIX does not publish it:

```sh
npm ci
npm test
npm run package
npm run vsix:pre-release -- --out stm32-build-analyzer-enhanced-1.2.0.vsix
```

Publishing requires a separate, deliberate command and valid publisher
credentials:

```sh
npx vsce publish --no-dependencies --pre-release
```

## Automated release gate

- `npm test` passes on Linux and Windows.
- `npm audit --omit=dev` and the accepted full development audit pass.
- The production webpack build contains no source maps.
- The VSIX contains the manifest, both production bundles, documentation,
  icons, and webview resources.
- The VSIX excludes sources, tests, fixtures, `node_modules`, local settings,
  task plans, TypeScript, and source maps.
- The packaged manifest reports version `1.2.0` and the unchanged extension ID.

## Manual smoke matrix

Install the VSIX into a clean VS Code profile and test at least:

| Area | Required checks |
| --- | --- |
| Compatibility | Existing GNU Arm project opens with unchanged settings and command IDs |
| Discovery | Matching `.map`/`.elf`, `.map`/`.axf`, and `.map`/`.out` pairs are found |
| Detection | Each supported family is named correctly; weak/conflicting evidence is unknown or ambiguous |
| Analysis | Regions, sections, symbols, source links, usage totals, and partial warnings match known artifacts |
| Tool handling | Configured path, PATH fallback, missing required tool, optional `nm`, timeout, and cancellation behave correctly |
| MAP-only adapters | Keil and IAR reports analyze without proprietary tools and without executing AXF/OUT artifacts |
| Refresh | Rebuilds, exact-file watching, manual pairs, and superseded refreshes do not publish stale data |
| Trust | An untrusted workspace cannot start native analysis tools |
| Platforms | Repeat core GNU Arm and one non-GNU case on Windows and Linux |

## Feedback record

For every tested artifact, record the extension version, operating system,
toolchain/linker version, target architecture, MAP format, executable format,
result status, and any redacted diagnostic codes. Do not attach proprietary MAP
files or binaries unless their license permits redistribution.

Rebranding, display-name changes, new imagery, and Marketplace positioning are
Phase 9 work and are not part of this pre-release.
