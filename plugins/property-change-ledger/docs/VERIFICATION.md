# Check evidence

Checks ran on 13 October 2026 on macOS with Node 22.23.2 and pnpm 10.30.3. The engine warning did not stop the checks.

## Commands

| Command | Exit | Evidence |
|---|---|---|
| `node tools/min-app-version.mjs property-change-ledger` | 0 | API floor 1.13.0. Public floor 1.13.4. |
| `pnpm exec turbo run lint test build --filter=property-change-ledger... --output-logs=errors-only` | 0 | 10 tasks passed. |
| `pnpm exec vitest run` in the product | 0 | 42 tests in 3 files passed. |
| `pnpm exec tsc -p test/e2e` in the product | 0 | Test types passed. |
| `pnpm run test:e2e` in the product | 0 | 9 tests on 1.13.4 and 9 on 1.14.4. 4 spec runs passed. |
| `./fx dev property-change-ledger` with the app lock and lane paths | 0 | Reload had 0 errors. 8 PNG files and 1 GIF file. |
| `./fx shots property-change-ledger` with the app lock and lane paths | 0 | Images corrected and checked. |
| `./fx dev --quit` with the lane paths | 0 | Dev app stopped. Lock released. |
| `node tools/pro.mjs disclosure property-change-ledger --write` | 0 | Disclosure version 2. |
| `./fx check property-change-ledger` | 0 | PASS property-change-ledger. |
| `./fx check all` | 0 | 67 passed, 0 failed. |
| `./fx export property-change-ledger` with the lane npm cache | 0 | 2 clean builds gave the same SHA-256. |

Export SHA-256 for main.js:

`5e556d5499bf9cc97fecfab742fa09589b64130a52261987842b4e61051be988`

The export tree and the lane npm cache were removed after this check.

## Media check

Opened the PNG files and the 4 GIF steps and the final repeated frame. The images show sample notes or their observed history. The filter has 2 Atlas status records. The count view has 2 Atlas status changes and 1 Beacon status change. The CSV image shows the local export notice. The profile image shows Project review.

| Image | Bytes |
|---|---|
| `baseline.png` | 110239 |
| `counts.png` | 165517 |
| `csv.png` | 156916 |
| `filter.png` | 149388 |
| `ledger.png` | 190995 |
| `profiles.png` | 128535 |
| `property-change-ledger.gif` | 347810 |
| `recent.png` | 173222 |
| `watch.png` | 117139 |

## Limits of the checks

No physical mobile device test, Linux CI run, live GitHub account sign-in, or payment test was done. Pro tests used the shared Sponsors manager with a test transport answer. No test covered two-device sync conflicts, a very large ledger, or an interrupted disk write. A failed write was tested with a vault mock and a serial queue test.

## Insight

A baseline is not history. The first cached value must set the comparison state before the plugin can record a change with an observed time.
