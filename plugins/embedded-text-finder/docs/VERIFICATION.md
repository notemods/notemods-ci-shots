# Build checks

Date: 12 October 2026. System: macOS. Branch: run/w12-embedded-text-finder.

## Commands

Use the worktree root unless a row gives another folder. Use the Obsidian app lock for app commands. Set FX_HUMANIZE to tools/humanize/scan.py. Set FX_NPM_CACHE to the lane cache in the home folder.

| Command | Exit | Evidence |
| --- | --- | --- |
| pnpm install --frozen-lockfile | 0 | Initial workspace install. |
| pnpm install --no-frozen-lockfile --prefer-offline --reporter=append-only | 0 | Add the product and shared license package. |
| node tools/min-app-version.mjs embedded-text-finder | 0 | API floor 1.13.0. First public version 1.13.4. |
| pnpm exec turbo run lint test build --filter=embedded-text-finder... --output-logs=errors-only | 0 | 48 unit tests in 3 files. 30 golden vectors. |
| pnpm exec tsc -p test/e2e in the product folder | 0 | End-to-end types pass. |
| pnpm run test:e2e in the product folder | 0 | 9 tests on 1.13.4 and 9 tests on 1.14.4. 4 spec runs pass. |
| ./fx dev embedded-text-finder | 0 | Reload with 0 errors. 7 PNGs and 1 GIF. |
| node tools/pro.mjs disclosure embedded-text-finder --write | 0 | Payment block from product.yaml. |
| python3 tools/humanize/scan.py --strict products/embedded-text-finder/README.md | 0 | Prose scan passes. |
| node tools/readme-gate.mjs embedded-text-finder | 0 | 1,404 words. 7 feature sections. 8 images. |
| ./fx check embedded-text-finder | 0 | PASS embedded-text-finder. |
| ./fx export embedded-text-finder | 0 | Two clean builds have the same hash. |
| npm ci --no-audit --no-fund --loglevel=error in the export folder | 0 | Standalone dependencies install. |
| npm test in the export folder | 0 | 48 standalone unit tests pass. |
| ./fx check all | 0 | 38 passed. 0 failed. |

Export main.js SHA-256 for build A and build B:

`ff51f71bb49c68b143d92e8f86662d7224b348520c7ccf188481b3ba79b6fd3e`

## Image checks

Open and check the 7 final PNGs. Each shot shows sample notes or search results. The reports shot shows missing Markdown, skipped PDF, a cycle and the depth limit. The preset shot shows a selected preset and the enabled local index. The export shot shows source links and plain excerpt text. Decode and check the GIF frames.

| File | Bytes |
| --- | --- |
| containing-notes.png | 158159 |
| heading-source.png | 160863 |
| block-source.png | 141746 |
| depth-two.png | 123012 |
| source-reports.png | 181885 |
| presets-index.png | 155770 |
| result-export.png | 264260 |
| embedded-text-finder.gif | 181268 |

## Limits

No physical mobile device test. No Linux desktop test. No large-vault performance test. No live GitHub payment or OAuth sign-in test. Use a local sponsorship response for the Pro tests. Setext headings, formatted headings, remote content, PDF text, Canvas, HTML rendering and third-party rendered blocks are outside this version.

The index has no automatic background build. It keeps parsed source documents in memory. File events remove changed entries. A search refills them. This cut keeps the bounded search job complete.
