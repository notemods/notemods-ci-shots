# Bases Freeze Panes

Bases Freeze Panes keeps the header and first column of a Bases table in view while you scroll, like a spreadsheet.

It supports base files, note embeds and base code blocks. The header and first column are free. Pro adds 2 or 3 frozen columns, a column count for single files and views, a pinned last column, and a property pin. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply.

## Features

<img src="https://raw.githubusercontent.com/theluckystrike/bases-freeze-panes/HEAD/docs/bases-freeze-panes.gif" alt="Scrolling a wide base down and to the right while the header row and the file name column stay put" width="720">

Pro costs $15 one time or $5 a month: [Sponsor](https://github.com/sponsors/theluckystrike?metadata_source=bases-freeze-panes) or [$15 one-time offer](https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-freeze-panes).

### Frozen header and first column in base files

<img src="https://raw.githubusercontent.com/theluckystrike/bases-freeze-panes/HEAD/docs/base-file.png" alt="A base file scrolled down and to the right with the header row and the file name column in place" width="720">

In a wide base, the first column stays in place when you scroll right. The other columns slide under it, and a thin line marks its edge. The header has a solid background.

### Embedded bases keep their header

<img src="https://raw.githubusercontent.com/theluckystrike/bases-freeze-panes/HEAD/docs/embedded-base.png" alt="A base embedded in a note scrolls inside its own box, and its header row sticks at the top" width="720">

An embedded base normally grows to the height of all its rows, so its header scrolls away with the note.

The plugin caps embedded tables at 500 pixels by default. A taller table scrolls inside this box, so its header row sticks to the top.

### Frozen Markdown and Dataview tables

<img src="https://raw.githubusercontent.com/theluckystrike/bases-freeze-panes/HEAD/docs/note-tables.png" alt="A Markdown table in its own scroll box with the header and first column in view" width="720">

Turn on "Freeze Markdown and Dataview tables" in the settings. This free feature gives each rendered table in a note tab its own scroll box. The header stays at the top, and the first column stays on the left. Cell text does not wrap, so a wide table scrolls to the side. It works in reading view and live preview.

The main switch, the file switch, the header switch, "Frozen columns" (0 or 1) and the height setting apply. Dataview queries need the Dataview plugin.

### Two or three frozen columns (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/bases-freeze-panes/HEAD/docs/two-columns.png" alt="Two frozen columns keep the title and the author in view" width="720">

With Pro you can freeze 2 or 3 columns, for example the file name and the author of a book. Change the column order in the base to choose which come first.

### Pinned last column (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/bases-freeze-panes/HEAD/docs/last-column.png" alt="The last column of a wide base stays at the right edge while the middle columns scroll" width="720">

Turn on "Freeze the last column" to keep it at the right edge. Use it for a status, a total or a due date.

### Pin a property (Pro)

Type a property name in "Pin a property", for example `author`, `note.author` or `formula.total`. When that property is visible in a Bases table, it stays beside the leading frozen columns. A hidden property stays hidden.

Clear the field to remove this pin. If the property is also the last column, it uses the left edge. Note tables do not change.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-freeze-panes/HEAD/docs/pin-property.png" alt="The author property stays beside the title while the middle columns scroll" width="720">

### Reading view, live preview and code blocks

<img src="https://raw.githubusercontent.com/theluckystrike/bases-freeze-panes/HEAD/docs/reading-view.png" alt="A base code block in reading view with the header row and the first column frozen" width="720">

Freezing works for every table view of a base in a note: embedded base files, base code blocks, live preview and reading view.

### Solid cells in light and dark themes

<img src="https://raw.githubusercontent.com/theluckystrike/bases-freeze-panes/HEAD/docs/light-theme.png" alt="The frozen cells stay solid in the light theme" width="720">

Frozen cells use theme colors, so the cells that slide under them stay hidden.

### Choices for one file

<img src="https://raw.githubusercontent.com/theluckystrike/bases-freeze-panes/HEAD/docs/file-columns.png" alt="Set frozen columns for the current file picks 0 to 3 columns for one base or note" width="720">

Two commands change one base file or note:

- "Turn frozen panes on or off for the current file" is free.
- "Set frozen columns for the current file" picks 0 to 3 columns for that file. This one needs Pro.

Each choice moves with its file or folder when you rename or move it, and goes away when you delete the file. The settings list the choices.

### Choices for one view

<img src="https://raw.githubusercontent.com/theluckystrike/bases-freeze-panes/HEAD/docs/view-choice.png" alt="The command modal for one view with the view switch, the header switch and the frozen columns" width="720">

A wide view may need frozen columns while a narrow view does not. Open the view, then run "Set frozen panes for the current view". In a note, it needs exactly one embedded view.

- "Freeze this view" and "Freeze the header row" are free. Header off also removes the height cap of an embedded view.
- "Frozen columns" sets 0 to 3 columns for the view. This needs Pro.
- "Use the file choice" removes the view choice.

A view choice is saved with the open file, so a base-tab choice does not reach notes that embed the view. It wins over the file choice, but a file that is off stays off. A renamed view leaves its old `file > view` choice in the settings to delete. Markdown and Dataview tables ignore view choices.

## Install

Open Settings, Community plugins, then Browse. Search for "Bases Freeze Panes". Select Install, then Enable.

To install by hand, download `main.js`, `manifest.json` and `styles.css` from the latest release. Put them in `<vault>/.obsidian/plugins/bases-freeze-panes/`. Reload the community plugins, then turn on Bases Freeze Panes.

Bases Freeze Panes needs Obsidian 1.13.4 or newer and the Bases core plugin. Tests for this update ran on desktop Obsidian 1.14.4.

## Usage

1. Turn on the plugin. Bases tables now have a frozen header and first column.
2. Open a wide base and scroll down and to the right.
3. To compare with the normal table, run "Turn frozen panes on or off". Run it again to undo.
4. For Pro, sponsor on GitHub, then open the settings and select "Sign in with GitHub".

## Pro

<img src="https://raw.githubusercontent.com/theluckystrike/bases-freeze-panes/HEAD/docs/pro-settings.png" alt="The Pro section of the settings after sign in, with the GitHub account and the Pro status" width="720">

Sponsor through the links above, then select "Sign in with GitHub" in settings. Saved choices return when Pro is on again.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-freeze-panes/HEAD/docs/settings.png" alt="Settings with the Pro section, the main switch, the header row, the number of frozen columns and the height of embedded tables" width="720">

| Setting | Default | Allowed values |
| --- | --- | --- |
| Freeze panes | On | On or off |
| Freeze the header row | On | On or off |
| Freeze Markdown and Dataview tables | Off | On or off (free) |
| Frozen columns | 1 | 0 to 3 (2 and 3 need Pro) |
| Freeze the last column | Off | On or off (Pro) |
| Pin a property | Empty | A visible property name (Pro) |
| Embedded table height | 500 | 200 to 1200 pixels, in steps of 50 |
| Choices for single files | Empty | File choices and `file > view` choices from the commands |

Delete an entry in "Choices for single files" to remove it. If a saved value is out of range, the plugin moves it to the nearest allowed value.

## FAQ

### Why did my CSS snippet for the first column not work?

The core table draws only visible cells to stay fast on large bases. After you scroll right, the first-column cells leave the page. The plugin keeps and pins them.

### Does it change my base files or notes?

No. It writes only its own settings file, `data.json` in the plugin folder.

### What happens after an Obsidian update?

The plugin checks the Bases table before it changes anything. If a future update changes the table, columns stop freezing and the settings tab says so. The header row keeps working.

### Why is the outline of the selected cell not visible in a frozen column?

The core app draws that outline in a separate layer. You can still click and edit the cell.

### Does it work for cards and list views?

No. Only table views have rows and columns to freeze.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Bases Freeze Panes makes no network requests. Sign in uses the GitHub device flow. Bases Freeze Panes sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Bases Freeze Panes sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Plugin page: [bases-freeze-panes](https://notemods.com/plugins/bases-freeze-panes/).

Report bugs and feature requests in this repository's issue tracker. Include your Obsidian version, theme and the view settings of the base.

To build from source:

```
npm ci
npm run build
npm test
```

## License

MIT

## Community

Questions, bugs or plugin ideas? Talk to me and other Obsidian users in [Zovo Chat](https://t.me/+k2MM-BIc7SQ5OWM0) on Telegram. It has a topic for these plugins. You can also open an issue here.
