# Build lane validation

Date: 2026-10-21. Branch: `sprint1021/bases-multi-edit`.

## Passed

- `pnpm install --offline --frozen-lockfile`: exit 0.
- `node tools/check-product.mjs bases-multi-edit`: static gate ok, 10 golden vectors.
- `node tools/min-app-version.mjs bases-multi-edit`: required API 1.13.0, first public release 1.13.4; manifest is 1.13.4.
- `pnpm exec turbo run lint test build --filter=bases-multi-edit... --output-logs=errors-only`: 10 successful tasks.
- `pnpm --filter bases-multi-edit test`: 55 passed tests in 3 files.
- `pnpm --filter bases-multi-edit exec tsc -p test/e2e`: exit 0.
- `python3 tools/humanize/scan.py --strict products/bases-multi-edit/README.md`: PASS, no hard or soft violations.
- `./fx export bases-multi-edit`: exit 0, two clean builds with the same SHA-256: `8087cce94ae50c4821b490daf3170bd3a513a5b57192f715bc694f587c9d39d4`.

## Blocked

`./fx check bases-multi-edit` ended with `FAIL bases-multi-edit`. Static, version, humanize, workspace lint/test/build and directory emulation lint passed. The README gate failed because screenshots and the GIF could not be captured.

Two locked `timeout 900 ./fx dev bases-multi-edit` attempts used the required separate profile and vault. The installed app and the cached Obsidian 1.14.4 app each failed to open the CLI socket within 60 seconds. No vault opened and the plugin did not run. A process sample placed the app in AppKit initialization, waiting on `_LSCopyServerStore`. The user Launch Services daemon, PID 717, was stuck exiting. macOS refused its service restart with error 150 while System Integrity Protection was engaged. No security setting was changed. Stale lane app processes were stopped.

A later launch and final gate retry were stopped by the disk floor: `df -g /System/Volumes/Data` reported 19 GB available. No new heavy build or app was started below the floor. Temporary build output was cleaned after its checks; no user data was removed for space.

Real-app end-to-end execution and visual QA are unverified. `qa.json` contains selection, preview, apply/undo, append and removal checks, plus the GIF sequence. No synthetic media was supplied. The export-tree test and release simulation were not run because the required full product gate did not pass. The initial changeset remains pending, as required for owner review.

## Scope

The product uses a custom Bases table view through the public API. It does not read built-in table selection. Free includes every editing operation, preview and last-batch undo. Pro adds saved actions and up to 20 session undo batches. Grouping is flattened, formulas are read-only, and undo is in memory. These limits are in the README and brief.
