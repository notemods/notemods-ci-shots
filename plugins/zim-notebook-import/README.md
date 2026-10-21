# Zim Notebook Import

Zim Notebook Import converts basic Zim Desktop Wiki pages into linked Markdown notes. Select a source folder already in your vault, review the proposed paths, and write the notes to a new folder. The source files stay in place so that you can compare the result with your notebook.

The free converter handles a small, tested set of Zim syntax. The report identifies unresolved page links and recognized unsupported sections. Pro adds saved import rules and a comparison of source text for a later import.

<img src="https://raw.githubusercontent.com/theluckystrike/zim-notebook-import/HEAD/docs/zim-notebook-import.gif" alt="A source plan, an imported garden note and the conversion report" width="720">

## Features

### Review a source folder

Use a folder of Zim `.txt` pages within the current vault. The plan shows the source path and output path of each selected page. It also shows a preview of the first note, issue counts and conflicts. Review that list before you select "Write new notes". Editing an input makes the previous plan invalid.

The destination must be new and separate from the source. A case-insensitive output collision stops the batch before a write. The conflict message identifies the source paths. An existing destination also blocks the import, including a destination that already has a planned note.

<img src="https://raw.githubusercontent.com/theluckystrike/zim-notebook-import/HEAD/docs/plan.png" alt="Three planned garden notes with source paths and issues" width="720">

### Convert basic page text

The converter removes recognized Zim headers of wiki format 0.4, 0.5 and 0.6 from the body. Current Zim releases write format 0.6. A page with a different format number keeps its full text, and the report lists it. Other header fields stay as text and go in the report. Headings with two through six equals signs become Markdown headings. Bold text keeps its markers; supported italic text becomes Markdown emphasis. Basic numbered and bullet lists retain their line order and indentation. Triple-quoted code blocks become fenced Markdown code. Code text is kept inside the fence, including strings that look like links.

Zim checkbox lines become Markdown tasks with the same tab depth: `[ ]` becomes `- [ ]` and `[*]` becomes `- [x]`. A Zim `[x]` marks a dismissed item, so it becomes `- [c]` and not a finished task. `[>]` and `[<]` keep their symbols. Obsidian draws `- [c]` as a checked box without a strike through the text. A theme or plugin can style the `c`, `>` and `<` statuses. A checkbox that Zim does not read as a list item stays as source text. This includes a checkbox in the middle of a line, a checkbox with no space or tab after it and a checkbox indented with spaces. A checkbox followed by a space but no text becomes an empty task. A checkbox line with other unsupported syntax stays as source text too. Both cases go in the report.

Supported page links use mapped output paths. A leading plus selects a child page, while a leading colon selects a page from the notebook root. Bare links search the current section, then its parents. Lookup resolves the first component before the remaining children. A closer namespace with a missing child does not redirect to a distant page. Labels remain on resolved links. Missing targets and ambiguous matches remain as source links and appear in the report.

<img src="https://raw.githubusercontent.com/theluckystrike/zim-notebook-import/HEAD/docs/conversion.png" alt="A garden note with converted headings, text, lists, code and links" width="720">

### Keep source properties

The `zim_source` property records the original vault path. A supported source header's creation date becomes `zim_created`. The date text is preserved rather than replaced with the import date. A page without a creation-date header gets the source property without a guessed date.

Zim file names encode spaces with `_`; those characters become spaces in page names. Unicode text remains in the note. Reserved characters become hyphens. The converter removes trailing dots and spaces. Reserved device names get an underscore prefix. Output spaces follow vault path normalization. These changes take place before link mapping and conflict checks, so a renamed note and its supported links use the same path.

<img src="https://raw.githubusercontent.com/theluckystrike/zim-notebook-import/HEAD/docs/properties.png" alt="Original Zim source path and creation date above the soil note" width="720">

### Read the import report

The destination receives `Zim import report.md`. It lists created-note counts and the source path, line and reason for detected issues. Images, table lines, underline and recognized object blocks stay as source text. They are not converted into assets or interactive controls. Files with other extensions remain in the source folder and their paths appear in the report.

Review these entries against the originals. A successful basic conversion does not mean that the complete Zim format was supported. An unclosed triple-quoted block remains text and is reported. An unsupported or incomplete Zim header keeps the page text without basic conversion.

<img src="https://raw.githubusercontent.com/theluckystrike/zim-notebook-import/HEAD/docs/report.png" alt="Source locations of unsupported content and an unresolved page link" width="720">

### Save import rules (Pro)

Choose tree folders or a flat destination. Choose spaces or hyphens in output page names. These choices can be used for a free import in the open import screen. With Pro, select "Save rules" to retain the source, destination and naming choices for the next command. Saved choices load when Pro is active. Change the destination when the previous folder already exists.

<img src="https://raw.githubusercontent.com/theluckystrike/zim-notebook-import/HEAD/docs/saved-rules.png" alt="Saved folder and page-name rules in the import screen" width="720">

### Compare a later source (Pro)

After a completed import, the plugin saves a source-text snapshot in its vault settings. The later-preview command compares that snapshot with the current `.txt` pages. It lists added, changed and removed paths, plus an unchanged count. The preview compares source text. It does not merge edited output notes.

To convert again, review a new plan and use a new destination. The preview does not overwrite previous results. The snapshot contains a copy of imported source text; include that settings file in your storage and sync decisions.

<img src="https://raw.githubusercontent.com/theluckystrike/zim-notebook-import/HEAD/docs/later-preview.png" alt="One changed source page compared with the first import" width="720">

## Install

Open Settings, then Community plugins, then Browse, and search for "Zim Notebook Import". Select Install, then Enable. It requires Obsidian 1.13.4 or later. To install by hand, copy `main.js`, `manifest.json` and `styles.css` from a GitHub release into `<vault>/.obsidian/plugins/zim-notebook-import/`.

## Usage

1. Copy a Zim notebook folder into your vault. Keep the directory structure around its page files.
2. Run "Zim page import" from the command palette.
3. Enter the source folder path and a new destination path relative to the vault.
4. Select "Review plan". Check paths, conflicts and report entries.
5. Select "Write new notes". Open the destination and compare the notes with the originals.

The plugin rereads the source and repeats conflict checks before writing. If the source changed after review, make a new plan. If storage fails during writing, a partial destination can remain. The error states how many notes were created. Keep that output for review and use a fresh destination for a retry.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

The import screen holds folder and page-name choices. The plugin settings tab holds GitHub Sponsors controls. Free conversion needs no account. Source and destination paths cannot contain parent path segments. The reserved report name cannot also be a converted page name.

## FAQ

### What was not tested?

A physical mobile device, Windows and Linux app runs, live GitHub sign in, payment, large production notebooks, network-mounted vaults and full Zim extension syntax were not tested. The plugin uses public vault and browser APIs without Node or Electron dependencies. That code choice does not establish device compatibility.

### Does this import ZIM archives?

No. This accepts Zim Desktop Wiki text pages. Offline web archives with a `.zim` extension are a different format. Attachments, equations and complete table conversion are outside this version.

### Can I remove the plugin after conversion?

The output is Markdown with YAML properties and vault links. You can read and edit those notes without this plugin. Keep the original notebook until you finish checking the result.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Imported text can contain HTML or remote image links. If you open that text or the report in a rendered view, Obsidian can request those remote resources. Review untrusted source text before you open the result.

Until you select "Sign in with GitHub" in the settings, Zim Notebook Import makes no network requests of its own. Sign in uses the GitHub device flow. Zim Notebook Import sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Zim Notebook Import sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Report a bug through the repository issues after publication. Include your Obsidian version, the reported source line and a small sample you can share. Remove private text before posting. This project uses the MIT license.
