# Review r3

Verdict: SHIP. Seven defects fixed. No open defect.

Date: 12 October 2026. Product: embedded-text-finder. Branch: run/w12-embedded-text-finder.

The reviewer read all six source files, the tests, `BRIEF.md`, `README.md`, `manifest.json`, `product.yaml`, `qa.json`, and the build report `b3.md`. The first product check passed with exit code 0.

## Defects and fixes

Line numbers below identify the final source. The review commit contains each fix.

| ID | Severity | File and line | Defect | Fix and regression test |
| --- | --- | --- | --- | --- |
| D1 | Medium | `src/search.ts:35` | Code spans across lines expanded embeds. | Match backtick runs of equal length across lines. The code-span test failed before the fix. |
| D2 | Medium | `src/search.ts:122` | Cancel during the last read showed a complete result. | Check cancellation after awaited reads and section lookups. The last-read test failed before the fix. |
| D3 | Medium | `src/store.ts:14` | A stale block ID prefix or paragraph start returned the wrong text. | Check the full ID and plain-paragraph boundaries. Both stale-block tests failed before the fixes. |
| D4 | Medium | `src/main.ts:19`, 34 | Startup work registered listeners or a timer after unload. | Check active state after settings load and before layout-ready work. Both unload tests failed before the fixes. |
| D5 | Medium | `src/search.ts:98`, 123 | 1,000 copies of one missing section caused 1,000 retry waits. Repeated searches also rebuilt masked text. | Reuse each section lookup within the search and keep masked text in the document. The repeated-section test failed before the fix. |
| D6 | Medium | `README.md:79`, 85, 87; `tools/pro.mjs:142` | The payment text omitted six-hour retries, left the start of the offline allowance unclear, and promised future free pricing. | Use disclosure version two for this product. State the retry rule and the last successful check. Remove the future-price promise. The generator test failed before the fix. |
| D7 | Medium | `src/search.ts:130` | Masked code became literal spaces and produced a false match. | Check a candidate against the original source text. The literal-space test failed before the fix. |

The source has no source-note deletion or edit path. A test with duplicate file names confirms that the source button opens the matched root note.

## Policy and guideline check

Read the official [developer policies](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Community%20directory/Developer%20policies.md) and [plugin guidelines](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Plugins/Releasing/Plugin%20guidelines.md). The original docs URLs returned Not Found. The official repository supplied the current files.

| Check | Result |
| --- | --- |
| User data in innerHTML, outerHTML, or insertAdjacentHTML | None. The modal uses text fields and createEl. |
| Global app or production console.log | None. Product methods use this.app or an explicit App parameter. |
| Unload cleanup | Fixed D4. Close modals, cancel searches, clear the index, remove registered events and the interval. |
| Event registration | Vault events use registerEvent. The interval uses registerInterval. DOM listeners belong to modal elements removed on close; the guidelines permit this local-element case. |
| Hotkeys and command names | No default hotkey. The command name does not include the product name. |
| Settings headings | General rows have no heading. Pro has a separate group. The code adds no HTML heading. |
| Note edits | No existing-note edit. Export uses Vault.create. Existing notes need no Vault.process or processFrontMatter call. |
| Network and hosts | Three requestUrl sites in the shared Sponsors adapter. Only github.com and api.github.com. No search-data transport. |
| Desktop-only flag | false. No Node or Electron API in the product runtime. This flag does not prove device support. |
| Description | Ends with a period. It contains neither Obsidian nor plugin. |
| License and disclosures | MIT file present. The payment, account, and network text is present and corrected. |

The Pro configuration and facade match `products/bases-link-graph/src/pro.ts` except for the feature summary. The client ID is Ov23lic5UPGPZqhBlBGg. The prices are $5 monthly or $15 once. The scope has the value read:user. Free search has no Pro guard. Presets, the index, and export have Pro guards. Shared tests check signed-out network silence and device-local token storage.

## Fact audit

Repeated statements share one row. Each row lists its README or manifest location. The rows identify instructions and declared metadata. PROVEN means the current source and listed evidence support the bounded claim. FIXED means the claim needed a code or wording change. The final claim now has evidence. REMOVED means the original claim was NOT PROVEN and is absent from the final text. A desktop-only flag of false is not a claim that a physical mobile device passed a test.

Source paths below start at products/embedded-text-finder unless they start with packages, tools, or `AGENTS.md`. Golden cases are in `packages/spec/vectors/embedded-text-finder.json`.

Counts: 103 claims; 95 proven without a claim fix; 7 fixed; 1 removed. No retained claim has the status NOT PROVEN.

| Location | Claim | Source or evidence | Result |
| --- | --- | --- | --- |
| README 3, 5, 13 | Find containers from bodies and static embeds; show source paths. | `src/search.ts:106`; `src/search.ts:138`; `tests/vectors.test.ts:25` | PROVEN |
| README 3, 13, 65 | Sources can be outside the selected container folder. | `src/search.ts:106`; `src/store.ts:41`; golden cases 16, 17, 30 | PROVEN |
| README 5 | The bird example returns the daily review and source. | `docs/sample-notes/Review/Daily review.md:1`; `test/e2e/finder.e2e.ts:24` | PROVEN |
| README 5, 19, 25, 61 | Open the container or source, with its heading or block suffix. | `src/modal.ts:123`; `src/modal.ts:125`; `test/e2e/finder.e2e.ts:48` | PROVEN |
| README 13, 59 | The folder control and text field start a literal search. | `src/modal.ts:29`; `src/modal.ts:84`; `src/search.ts:130`; `tests/review.test.ts` literal-space case | FIXED |
| README 13, 65 | Include subfolders; exclude sibling folders. | `src/search.ts:88`; golden cases 16 and 17 | PROVEN |
| README 13 | A body match uses the same container and source path. | `src/search.ts:150`; golden case 11 | PROVEN |
| README 13, 31 | One match per source range per container; use the first excerpt. | `src/search.ts:107`; `src/search.ts:134`; golden cases 14 and 25 | PROVEN |
| README 13 | Text comparison is case-sensitive. | `src/search.ts:130`; golden case 18 | PROVEN |
| README 13 | Brackets and stars have no regular-expression meaning. | `src/search.ts:130`; golden case 10; `test/e2e/finder.e2e.ts:45` | PROVEN |
| README 19 | A heading embed searches the selected section. | `src/store.ts:45`; `src/search.ts:124`; golden case 2 | PROVEN |
| README 19 | Exclude text from other sections. | `src/store.ts:5`; `tests/metadata.test.ts:6`; golden cases 2 and 26 | PROVEN |
| README 19 | Include child headings through the next peer or parent heading. | `src/store.ts:9`; `tests/metadata.test.ts:3` | PROVEN |
| README 19, 73 | Validate basic ATX headings. | `src/store.ts:6`; `tests/metadata.test.ts:3` | PROVEN |
| README 25 | A block embed searches the referenced block. | `src/store.ts:45`; `src/search.ts:124`; golden case 3 | PROVEN |
| README 25 | Get the block ID from public metadata. | `src/store.ts:50`; `node_modules/obsidian/obsidian.d.ts:2255` | PROVEN |
| README 25 | Exclude text outside a block, including stale paragraph ranges. | `src/store.ts:14`; `tests/review.test.ts` stale block and paragraph cases | FIXED |
| README 25 | Retry missing or stale sections once, then report them. | `src/store.ts:48`; `src/store.ts:59`; `src/search.ts:123`; `tests/review.test.ts` repeated missing-section case | FIXED |
| README 31 | A relay can return a source at depth two. | `src/search.ts:147`; golden case 4 | PROVEN |
| README 31 | Stop at the third embed level and report the limit. | `src/search.ts:146`; golden case 5 | PROVEN |
| README 31 | Show body, depth one, or depth two labels. | `src/modal.ts:121`; inspected `depth-two.png` | PROVEN |
| README 37 | Show missing targets, media, read failures, sections, cycles, and depth limits. | `src/search.ts:119`; `src/search.ts:121`; `src/search.ts:126`; `src/search.ts:144`; `src/modal.ts:131`; `tests/vectors.test.ts:49` | PROVEN |
| README 37 | The reports identify gaps in the search. | `src/modal.ts:134`; inspected `source-reports.png` | PROVEN |
| README 37 | Skip PDF content without reading it. | `src/search.ts:145`; golden case 7; `src/store.ts:34` | PROVEN |
| README 37 | Do not expand fenced examples. | `src/search.ts:27`; golden cases 8 and 28 | PROVEN |
| README 37 | Do not expand inline code, including code across lines. | `src/search.ts:35`; `tests/review.test.ts` code-span cases | FIXED |
| README 37 | Exclude front matter and comments. | `src/search.ts:18`; `src/search.ts:53`; golden cases 23 and 24 | PROVEN |
| README 37 | Yield between search batches. | `src/search.ts:105`; `src/search.ts:116`; `tests/vectors.test.ts:41` | PROVEN |
| README 37 | Cancellation stops more work and labels partial results. | `src/search.ts:122`; `src/modal.ts:113`; `tests/review.test.ts` last-read case | FIXED |
| README 43 | Presets store name, folder, and query. | `src/main.ts:53`; `tests/plugin.test.ts:22` | PROVEN |
| README 43 | Select a preset to restore fields. | `src/modal.ts:59`; `src/modal.ts:62`; inspected `presets-index.png` | PROVEN |
| README 43 | Saving an existing name replaces it. | `src/main.ts:52`; `tests/plugin.test.ts:22` | PROVEN |
| README 43 | Remove preset deletes the selected entry. | `src/main.ts:57`; `tests/plugin.test.ts:26` | PROVEN |
| README 43 | Retain up to 50 presets. | `src/main.ts:54`; `src/settings.ts:15` | PROVEN |
| README 43, 65 | The optional index holds parsed documents in memory and reuses unchanged data. | `src/search.ts:158`; `src/search.ts:165`; `tests/plugin.test.ts:44` | PROVEN |
| README 43 | File changes invalidate entries; the next search reads them. | `src/main.ts:30`; `src/search.ts:162`; `tests/plugin.test.ts:44` | PROVEN |
| README 43 | Rename events clear the index. | `src/main.ts:32`; `src/search.ts:163` | PROVEN |
| README 43 | Build the index on demand; no background search. | `src/store.ts:37`; `src/main.ts:46`; source review of all six files | PROVEN |
| README 49 | Pro export creates a Markdown note at the vault root. | `src/main.ts:68`; `tests/plugin.test.ts:28` | PROVEN |
| README 49 | Export container and source links, with section suffixes. | `src/search.ts:178`; `tests/plugin.test.ts:28`; inspected `result-export.png` | PROVEN |
| README 49 | Use a new numbered name when an export name exists. | `src/main.ts:72`; `tests/plugin.test.ts:28` | PROVEN |
| README 49 | Export the last search data. | `src/modal.ts:50`; `src/modal.ts:99` | PROVEN |
| README 49 | Label a cancelled export as partial. | `src/search.ts:179`; `tests/plugin.test.ts:59` | PROVEN |
| README 49 | Export does not alter the source notes. | `src/main.ts:73`; `tests/plugin.test.ts:28`; the code uses only Vault.create | PROVEN |
| README 49, 75 | The Pro demonstration uses a local sponsorship response. | `qa.json` result-export entry; `test/e2e/finder.e2e.ts` Pro fixture case | PROVEN |
| README 55 | Require Obsidian 1.13.4 or later. | `manifest.json:5`; public API gate; desktop tests on 1.13.4 and 1.14.4 | PROVEN |
| README 55 | Install `main.js`, `manifest.json`, and `styles.css` in the named folder; reload and enable. | `manifest.json:2`; `esbuild.config.mjs:1`; `test/e2e/load.ts:13`; builder export evidence | PROVEN |
| README 55 | The publisher controls releases and listing availability. | `AGENTS.md` hard rules; the text does not promise a current listing or download | PROVEN |
| README 55 | Use a backup before testing. | User instruction, not a claim about program behavior | PROVEN |
| README 55 | The source uses MIT. | LICENSE:1 | PROVEN |
| README 59 | The named command opens the search window. | `src/main.ts:29`; `test/e2e/finder.e2e.ts:48` | PROVEN |
| README 59 | Search or Enter starts the search. | `src/modal.ts:42`; `src/modal.ts:45` | PROVEN |
| README 59, 67 | Remember the last folder and query in `data.json`. | `src/modal.ts:95`; `src/main.ts:45`; `src/main.ts:18` | PROVEN |
| README 61 | Opening a result closes the window; the command opens it again. | `src/modal.ts:123`; `src/main.ts:44`; `test/e2e/finder.e2e.ts:48` | PROVEN |
| README 61 | Show the next 100 matches on request. | `src/modal.ts:119`; `src/modal.ts:128` | PROVEN |
| README 61 | Status shows match, completed-container, and report counts. | `src/modal.ts:113`; `src/search.ts:152` | PROVEN |
| README 61 | Show the first 100 reports. | `src/modal.ts:134` | PROVEN |
| README 65 | The search window holds folder, query, preset, and index controls. | `src/modal.ts:29`; `src/modal.ts:40`; `src/modal.ts:54`; `src/modal.ts:58` | PROVEN |
| README 65 | Vault root includes the Markdown notes. | `src/main.ts:47`; `src/search.ts:88`; `tests/review.test.ts` empty-vault case | PROVEN |
| README 65 | A smaller container folder narrows the list. | `src/search.ts:106`; golden case 16 | PROVEN |
| README 65 | Without the index, read current source content. | `src/store.ts:37`; `test/e2e/finder.e2e.ts:66` | PROVEN |
| README 67 | The settings tab describes search scope and has Sponsors controls. | `src/settings.ts:20`; `packages/license/src/github-obsidian.ts:205` | PROVEN |
| README 67 | Sign out turns Pro off and clears the index. | `packages/license/src/sponsors.ts:229`; `src/main.ts:24`; `packages/license/test/github.test.ts:367` | PROVEN |
| README 67, 79, 81 | The free search works without an account or Pro. | `src/main.ts:46`; `tests/plugin.test.ts:38`; `test/e2e/finder.e2e.ts:81` | PROVEN |
| README 67 | Disable the index to clear it while Pro remains on. | `src/main.ts:62`; `tests/plugin.test.ts:44` | PROVEN |
| README 67 | Closing the app removes the memory index. | `src/main.ts:39`; `src/search.ts:158`; `tests/plugin.test.ts` clear cases | PROVEN |
| README 67 | Store presets in `data.json`. | `src/main.ts:55`; `src/main.ts:45`; `tests/plugin.test.ts:22` | PROVEN |
| README 71 | Search static Markdown, without the full reading renderer. | `src/search.ts:16`; `src/search.ts:69`; `BRIEF.md` out-of-scope list | PROVEN |
| README 71 | No Markdown-image expansion, Dataview, HTML rendering, PDF text, Canvas, or remote content. | `src/search.ts:69`; `src/search.ts:145`; no renderer or remote-content call in product source | PROVEN |
| README 71 | Formatting markers can remain in excerpts. | `src/search.ts:137`; inspected `containing-notes.png` | PROVEN |
| README 73 | Cache updates or unsupported formatting can prevent heading results. | `src/store.ts:5`; `src/store.ts:48`; `tests/metadata.test.ts:6` | PROVEN |
| README 73 | Setext and formatted-heading validation are outside this version. | `BRIEF.md` out-of-scope list; `src/store.ts:6` | PROVEN |
| README 75 | The text makes no physical-mobile, Linux, large-vault, live-payment, or live-OAuth test claim. | `docs/VERIFICATION.md` Limits; `b3.md` Not tested; this review adds only synthetic scale tests | PROVEN |
| README 75 | Desktop tests use the earliest supported and latest public versions. | `wdio.conf.mts:25`; review desktop log for 1.13.4 and 1.14.4 | PROVEN |
| README 75 | Desktop tests do not prove mobile-device support. | No mobile claim retained; manifest false permits loading but does not certify a device | PROVEN |
| Original README 79 | The core stays free in all future versions. | NOT PROVEN. Future pricing is not a property of this source. Removed from disclosure version two. | REMOVED |
| README 79 | Pro requires $5 monthly or $15 once. | `src/pro.ts:9`; `packages/license/src/github.ts:203`; `packages/license/test/github.test.ts:217` | PROVEN |
| README 79 | A total of $15 gives lifetime Pro eligibility. | `packages/license/src/github.ts:248`; `packages/license/test/github.test.ts:287`; online-check rules still apply | PROVEN |
| README 79 | Notes remain readable and editable without Pro. | `src/main.ts:50`; `src/main.ts:69`; no note encryption or read/edit interception; `tests/plugin.test.ts` Pro guards | PROVEN |
| README 81 | Payment uses the named GitHub Sponsors page and the sponsor account. | `src/pro.ts:8`; `product.yaml` checkout_url; `packages/license/src/github-obsidian.ts:115` | PROVEN |
| README 83 | No requests before sign-in. | `packages/license/src/sponsors.ts:80`; `packages/license/test/github.test.ts:110`; hosts gate | PROVEN |
| README 83 | Device sign-in sends the public client ID and read:user to the code endpoint and shows a code. | `packages/license/src/github.ts:77`; `packages/license/src/github-obsidian.ts:128`; `packages/license/test/github.test.ts:141` | PROVEN |
| README 83 | Poll the token endpoint at the device-flow interval. | `packages/license/src/github.ts:146`; `packages/license/test/github.test.ts:164` | PROVEN |
| README 83 | The scope gives read-only profile access, with no repository or write scope. | `src/pro.ts:16`; `packages/license/src/github.ts:77`; `tools/pro-sponsors.test.mjs` scope test | PROVEN |
| README 85 | Query the sponsor, tier, and total paid through GraphQL. | `packages/license/src/github.ts:175`; `packages/license/src/github.ts:286`; `packages/license/test/github.test.ts:266` | PROVEN |
| README 85 | Keep a successful answer for seven days; retry failures after six hours; Refresh can request a check. | `packages/license/src/policy.ts:18`; `packages/license/src/sponsors.ts:80`; `packages/license/test/github.test.ts:316`; `tools/pro-sponsors.test.mjs` version-two test | FIXED |
| README 85 | A negative answer turns Pro off. | `packages/license/src/sponsors.ts:84`; `packages/license/test/github.test.ts:241` | PROVEN |
| README 85 | Send no note content, file names, vault data, or telemetry. | `packages/license/src/github-obsidian.ts:24`; `packages/license/src/github.ts:291`; `packages/license/test/github-obsidian.test.ts:47`; hosts gate | PROVEN |
| README 87 | Offline Pro lasts up to 14 days from the last successful check. | `packages/license/src/sponsors.ts:85`; `packages/license/test/github.test.ts:316`; `tools/pro-sponsors.test.mjs` version-two test | FIXED |
| README 87 | The token uses device SecretStorage, not vault files or `data.json`. | `packages/license/src/github-obsidian.ts:42`; `packages/license/test/github-obsidian.test.ts:64`; `packages/license/test/github-obsidian.test.ts:85` | PROVEN |
| README 87 | Device local storage has login, tier, and check times. | `packages/license/src/github-obsidian.ts:65`; `packages/license/src/sponsors.ts:17`; `packages/license/test/github-obsidian.test.ts:85` | PROVEN |
| README 87 | Sign out deletes the token. | `packages/license/src/github-obsidian.ts:56`; `packages/license/test/github.test.ts:367` | PROVEN |
| README 87 | GitHub can revoke the OAuth access in account settings. | [GitHub OAuth app review](https://raw.githubusercontent.com/github/docs/main/content/apps/oauth-apps/using-oauth-apps/reviewing-your-authorized-oauth-apps.md); `packages/license/test/github.test.ts:342` | PROVEN |
| README 91 | Support asks for versions, query, sample notes, expected paths, and source reports with private text removed. | Support instructions, not a behavior or response-time promise | PROVEN |
| README 91 | The publisher is theluckystrike at notemods.com. | User-supplied build brief; `src/pro.ts:8`; `manifest.json:8`; configured publisher identity | PROVEN |
| README 7, 15, 21, 27, 33, 39, 45, 51 | Image descriptions show the named search, section, depth, report, preset, index, and export features. | Opened all seven PNGs and all four decoded GIF frames; `qa.json:1`; image table below | PROVEN |
| manifest 2, 3 | ID embedded-text-finder; display name Embedded Text Finder. | `product.yaml:1`; `package.json` name; static gate | PROVEN |
| manifest 4 | The version is 1.0.0. | `product.yaml:4`; `versions.json:2`; version gate | PROVEN |
| manifest 5 | The minimum app version is 1.13.4. | Public API gate; desktop test on 1.13.4 | PROVEN |
| manifest 6 | Find containing notes by text in their Markdown embeds. | `src/search.ts:138`; golden cases 1, 2, 3, 4 | PROVEN |
| manifest 7, 8 | The author and author URL are the declared publisher metadata. | LICENSE:3; user-supplied publisher brief; metadata declaration, not an identity-verification service | PROVEN |
| manifest 9 | Funding uses the configured GitHub Sponsors URL. | `product.yaml` checkout_url; `src/pro.ts:8`; Sponsors gate | PROVEN |
| manifest 10 | The manifest permits mobile loading. | No Node or Electron import in product code or bundled runtime; README 75 states device tests are absent | PROVEN |

## Images

| File | Result |
| --- | --- |
| `docs/containing-notes.png` | Shows body and source excerpts with the blue bird query. |
| `docs/heading-source.png` | Shows Scope source links and the selected text. |
| `docs/block-source.png` | Shows Witness block source links and the witness text. |
| `docs/depth-two.png` | Shows the final source at depth two. |
| `docs/source-reports.png` | Shows missing Markdown, skipped PDF, a cycle, and a depth limit. |
| `docs/presets-index.png` | Shows a selected preset, enabled index, and sample results. |
| `docs/result-export.png` | Shows the Markdown result note with container and source links. |
| `docs/embedded-text-finder.gif` | All four decoded frames show search results, heading results, or source reports. |

## Limits

The reviewer did not test a physical mobile device, Linux runtime, live payment, or live OAuth. A synthetic repeated-section test is not a large-vault performance guarantee. The source retains the documented limits for Setext headings, formatted headings, dynamic blocks, PDF, Canvas, HTML rendering, and remote content. The shared disclosure generator keeps version one for existing products; this review enables the corrected version only for embedded-text-finder.

## Final checks

| Command | Exit | Result |
| --- | --- | --- |
| `timeout 900 ./fx check embedded-text-finder` before edits | 0 | First product gate. |
| `timeout 900 ./fx check embedded-text-finder` after code fixes | 0 | Static, version, prose, lint, tests, build, README, and hosts pass. |
| `timeout 900 ./fx export embedded-text-finder` | 0 | Two clean builds have the same SHA-256. |
| `pnpm exec vitest run` in the product folder | 0 | 63 tests in four files pass. |
| `node --test tools/pro-sponsors.test.mjs` | 0 | 12 generator and Pro gate tests pass. |
| `pnpm exec tsc -p test/e2e` in the product folder | 0 | Desktop test types pass. |
| `timeout 700 pnpm run test:e2e` in the product folder | 0 | Final source passes 10 tests on 1.13.4 and 10 tests on 1.14.4. Four spec runs pass. |

The app tests held the shared lock and released it after each run. The reviewer did not push or publish. A test command at the workspace root found no Vitest command. The same command passed in the product folder.

Export SHA-256 for both builds: `a7626e3c78e02483723cc1a898392f4073f984ff87e9d5fcfbb80422d0380268`.
