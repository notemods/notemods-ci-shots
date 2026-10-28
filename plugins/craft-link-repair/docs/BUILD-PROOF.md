# Craft Link Repair build proof

The build was checked on 13 October 2026. The branch is `run/w12-craft-link-repair`.

## Product checks

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | The worktree has the pinned packages. |
| `./fx new craft-link-repair --channel obsidian --name "Craft Link Repair" --desc "Restore Craft page links from exported note identifiers."` | 0 | The product was made from the template. |
| `pnpm install` | 0 | The new product and license package are linked. |
| `node tools/min-app-version.mjs craft-link-repair` | 0 | The API floor is 1.13.0. The first supported public release is 1.13.4. |
| `pnpm exec turbo run lint test build --filter=craft-link-repair... --output-logs=errors-only` | 0 | Seven tasks pass. |
| `pnpm --filter craft-link-repair run test` | 0 | 85 tests pass in three files. The suite has 47 golden vectors. |
| `pnpm --filter craft-link-repair exec tsc -p test/e2e` | 0 | The end-to-end types pass. |
| `pnpm --filter craft-link-repair run test:e2e` | 0 | Eight checks pass on 1.13.4. Eight checks pass on 1.14.4. |
| `./fx dev craft-link-repair` | 0 | The reload has zero errors. Six PNG files and one GIF were made. |
| `./fx dev --quit` | 0 | The dev app stopped. This lane released the app lock. |
| `node tools/pro.mjs disclosure craft-link-repair --write` | 0 | The payment block is generated with disclosure version 2. |
| `python3 tools/humanize/scan.py --strict products/craft-link-repair/README.md` | 0 | The README scan passes. |
| `node tools/readme-gate.mjs craft-link-repair` | 0 | 1,341 reader words, six feature sections, and seven images. |
| `./fx check craft-link-repair` | 0 | PASS craft-link-repair. Directory lint has zero problems. |
| `./fx export craft-link-repair` | 0 | Two clean builds have the same SHA-256. |
| `./fx check all` | 0 | 62 gates pass. Zero gates fail. The tools suite has 288 passing tests. The workspace has 160 passing tasks. |

App commands and end-to-end tests held the shared app lock. This lane used its own dev profile and vault. Commands that can hang had a timeout. Factory commands used `FX_HUMANIZE=tools/humanize/scan.py`. Export used `FX_NPM_CACHE=$HOME/.cache/pf-npm-w12-craft-link-repair`.

## Export hash

Both exported builds have this main.js SHA-256:

```text
25f789f5397cd28b2da441e1fac9dc93b388f410430eb592cab19c857f1ccb95
```

The exported tree and the lane npm cache were deleted after the check.

## Media check

Each PNG and the GIF were opened and checked. The GIF shows the sample note, preview, repaired copy, and report.

| File | Bytes |
| --- | --- |
| preview.png | 202114 |
| copies.png | 110843 |
| dates.png | 106254 |
| report.png | 165001 |
| pro-options.png | 165499 |
| automatic.png | 58104 |
| repair-flow.gif | 316976 |

The PNG limit is 409600 bytes. The GIF limit is 2097152 bytes. The media files pass these limits.

## Fixes

The first app test found an empty hostname for a Craft URL in Chromium 120. The parser now reads the Craft route before the query. A unit test and both app versions check the result. Test fixtures use Vault.create so that files are registered before a check. Expected test failures use a message field so that the test harness can return them.

## Not tested

- A customer export with private notes.
- A phone or tablet.
- Linux execution. CI must run the included suite on Linux.
- A real payment or GitHub device sign in. Pro tests use a local sponsor response.
- Import of an archive or an encrypted export.

## Scope

Source notes stay intact. Unsupported block links stay unresolved. The plugin creates local copies and reports. It does not copy attachments or update a prior repaired copy. These limits are stated in the brief and README.

## Factory note

The factory keeps an existing directory lint advisory for property-date-format. It does not fail that gate. This lane changed no source file of that product.
