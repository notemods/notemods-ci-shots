# Validation on 2026-10-21

The source is ready for review. The real app and media checks are blocked by a host startup fault. This product is not ready for release.

## Passed checks

- `pnpm install --offline --frozen-lockfile`: exit 0. A second offline install added the new product workspace and shared license dependency to the lockfile.
- `node tools/min-app-version.mjs tag-properties`: required API version 1.13.0, first public release 1.13.4, manifest 1.13.4.
- `pnpm exec turbo run lint test build --filter=tag-properties... --output-logs=errors-only`: 7 successful tasks.
- Vitest: 4 test files passed, 72 tests passed. Tests cover golden vectors, malformed values, distinct note counts, descendants, Pro access, settings, view interactions and clipboard fallback.
- `node tools/check-product.mjs tag-properties`: static gate ok, 6 main golden vectors, with extra list, child-match and native-expression vectors in the same file.
- `node tools/version-gate.mjs tag-properties`: version gate ok, 1.0.0 in sync.
- `python3 tools/humanize/scan.py --strict products/tag-properties/README.md`: PASS, no hard or soft findings.
- `node tools/pro.mjs hosts tag-properties`: hosts ok, api.github.com and github.com only.
- `node packages/spec/check-vectors.mjs`: vectors ok.
- `tsc -p test/e2e` from the product: exit 0. The real-app suite is prepared but has not run successfully.
- Full factory check also passed directory emulation lint with 0 problems.

## Blocked checks

`./fx dev tag-properties` was attempted with the required app lock, isolated profile and vault, and a 900-second timeout. Both the installed Obsidian 1.14.4 and the cached 1.14.4 installation failed to open the CLI socket in 60 seconds, before plugin loading. A retry with a fixed Foundation home path had the same result.

Process samples from both installations show startup waiting in `NSApplication`, `NSSafeAperture`, `CFURLCopyResourcePropertyForKey`, and a synchronous Launch Services XPC request. The per-user Launch Services job reported PID 717 as running, but that PID was absent from the process table. An attempt to restart only that user service returned:

```
Could not kickstart service "com.apple.lsd": 150: Operation not permitted while System Integrity Protection is engaged
```

A separate retry was stopped when buildslot reported 19 GB free. The coldstore plan had zero eligible items. The required five-minute wait was completed before the next attempt. No user data was deleted for space.

`./fx check tag-properties` exits 1 with `FAIL tag-properties`. Its only failing gate is README media: four PNG files and one GIF could not be captured. There are six image references because the opening screenshot is reused under its feature. The README has 1,324 reader words. No missing-media override or fabricated image was used.

The standalone export-tree test and simulated publish have not run because the required full factory PASS has not been obtained. No push, tag, public repository, release or listing was created.

## Resume

Repair the host app startup service, then run the isolated app workflow with the Obsidian app lock. The supplied `qa.json` covers the tag view, child selection, native Bases table, settings and GIF. Inspect each generated image. Run the real-app suite on the earliest supported and latest public versions, then the full factory gate, standalone export-tree gate and simulated publish in that order.

The core Properties editor, tag pane, search and graph are intentionally unchanged. Public APIs supply the dedicated view and native Bases expressions. Pro adds multiple selected properties and the combined custom/core view.
