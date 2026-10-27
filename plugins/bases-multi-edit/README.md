# Bases Multi-Row Edit

Change one property across selected rows in a Bases table. See each note's old and new value before you apply, then undo the batch from the same session.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-multi-edit/HEAD/docs/selection.png" alt="Project review table with two selected rows" width="720">

Pro adds saved bulk actions and 20 session undo batches for $15 one time or $5 a month. [Get Pro](https://github.com/sponsors/theluckystrike?metadata_source=bases-multi-edit) or choose the [$15 one-time offer](https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-multi-edit).

Mark projects done, add a tag to notes that already have tags, rename one tag in place, or clear an old owner property. Selection stays in the view, not in your notes.

## Features

### Select rows within a Bases query

<img src="https://raw.githubusercontent.com/theluckystrike/bases-multi-edit/HEAD/docs/bases-multi-edit.gif" alt="Select rows, preview an edit, apply it, and undo" width="720">

Choose the Multi-row edit view in a Base. It shows a table with the query's filters, sorting, and visible columns. Check rows or use Select visible to select all rows of the view, then choose Edit selected.

Selection lasts while the view is open. When a query update hides a row, that row leaves the selection. Only Markdown notes appear as rows. The view flattens grouped results into one list.

### Preview typed property changes

<img src="https://raw.githubusercontent.com/theluckystrike/bases-multi-edit/HEAD/docs/preview.png" alt="Per-note preview of status changing from todo to done" width="720">

Enter a top-level property name, an operation and a value type, and choose Preview changes. Names match without regard to case: `status` updates an existing `Status` key. Ambiguous duplicate keys are skipped. Set supports text, decimal numbers, checkboxes, and simple lists. Remove property deletes the whole key.

The preview lists each selected note with its old and proposed value. Missing properties show as absent. Notes whose values already match show as unchanged and are left out of the apply count. Nothing is written before you choose Apply. Editing a control discards the preview.

### Append or remove list items

<img src="https://raw.githubusercontent.com/theluckystrike/bases-multi-edit/HEAD/docs/append.png" alt="Preview appending review to empty and scalar tag properties" width="720">

Lists use JSON syntax such as `["project", "review"]`. Items can be text, finite numbers, booleans, or null. Empty properties become empty lists, and a scalar becomes a one-item list. Append keeps the existing items and their order and adds each new item once. Item matching is exact and case sensitive.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-multi-edit/HEAD/docs/remove.png" alt="Preview removing review from tag lists" width="720">

Remove list items keeps nonmatching values. Missing notes, unreadable YAML, and incompatible properties appear with a skipped reason beside the note path. Other notes remain available to apply.

### Replace a list item in place

<img src="https://raw.githubusercontent.com/theluckystrike/bases-multi-edit/HEAD/docs/replace.png" alt="Preview replacing the project tag with area" width="720">

Replace list items renames one item and keeps the others. Enter the items to find in Find items, for example `["project"]`, and the new items in Value, for example `["area"]`. The first found item takes the new items at its place, and other found items go. A new item that the list already has is not added again. For `tags`, matching ignores a leading `#` and letter case, and new tags are written without `#`. A note without a match stays unchanged.

### Apply with conflict checks and undo

<img src="https://raw.githubusercontent.com/theluckystrike/bases-multi-edit/HEAD/docs/undo.png" alt="Completed batch with an undo button" width="720">

Apply writes one note at a time. Before each write, it compares the file's modified time and size with the preview. A note is skipped when Obsidian has seen a change to its file after the preview, for example from sync. The result shows "File changed since preview" and the path. A later change to other properties or the body is kept. Apply also checks the target property inside the write. A test changes 500 notes in one batch and restores them with one undo.

Apply and undo re-serialize the whole frontmatter through Obsidian. YAML comments can be lost, and quoting, formatting, and key order can change. The preview shows this warning. Undo restores property values or absence, not the original YAML text. Note body text is preserved.

Undo restores the property when it still has the applied value, and keeps other changes to the note. If the target property changed since apply, undo skips it and keeps it for another attempt. Undo history stays in memory and ends when Obsidian restarts or the plugin reloads.

### Save repeated actions with Pro

<img src="https://raw.githubusercontent.com/theluckystrike/bases-multi-edit/HEAD/docs/settings.png" alt="Optional Pro offer and GitHub account controls" width="720">

Pro adds Save action and a saved action picker to the edit dialog. An action stores the property, operation, type, and input. It never stores a row selection. Choose the notes, load the action, and preview it. Up to 50 actions are stored locally. Clear saved actions in settings removes them all. Without Pro, Save action shows a Sponsor notice and saves nothing.

Pro also keeps up to 20 undo batches during the current plugin session. Without Pro, a new apply tells you when it drops the earlier batch. A batch with unresolved undo conflicts stays at the top until those entries can be restored.

## Install

Requires Obsidian 1.13.4 or newer with the core Bases plugin enabled. Search for Bases Multi-Row Edit in Community plugins, install it, and enable it.

For manual installation, put `main.js`, `manifest.json`, and `styles.css` from a release into `<vault>/.obsidian/plugins/bases-multi-edit/`. Reload plugins and enable it. It uses core APIs and supports desktop and mobile layouts.

## Usage

1. Open a Base and add or switch to a Multi-row edit view.
2. Adjust the Base filters and visible properties to show the notes you need.
3. Check the rows to change and choose Edit selected.
4. Enter a property, operation, type, and value.
5. Choose Preview changes and read the per-note results.
6. Apply, read any skipped paths, and use Undo last batch if needed.

For example, set property `status`, operation Set value, type Text, and value `done`. To add a tag, choose property `tags`, Append list items, List, and `["review"]`. To remove it, choose Remove list items. To rename it, choose Replace list items with Find items `["review"]` and Value `["checked"]`.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

The settings tab explains how to open the editing view and shows the optional Pro offer and GitHub Sponsors account controls.

The command palette also provides Undo the last bulk edit when a batch is available. You can assign a hotkey in Obsidian's Hotkeys settings. No hotkeys are assigned by default.

## FAQ

### Does this use the built-in table's selection?

It supplies its own Bases table view through the public API. Switch to Multi-row edit to use its checkboxes. It does not read private selection state from the built-in table.

### Can I edit file names or formula columns?

No. Those columns are visible for context but are read-only here. The property field accepts plain top-level note property names. Nested property paths, dots, colons, and unsafe object keys are rejected.

### What happens to hidden notes?

Preview checks that each selected note still belongs to the current query and skips hidden notes.

### Does removing the product remove my data?

Property edits are ordinary note frontmatter. Saved action definitions are in the plugin's local data file.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Bases Multi-Row Edit makes no network requests. Sign in uses the GitHub device flow. Bases Multi-Row Edit sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Bases Multi-Row Edit sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Visit [NoteMods](https://notemods.com/) for product information. Report bugs in this repository's issue tracker with your Obsidian version, the operation and a small example. Do not send account tokens or private notes.

Build from source with `npm ci`, `npm run build`, and `npm test`. The source and tests are licensed under MIT.
