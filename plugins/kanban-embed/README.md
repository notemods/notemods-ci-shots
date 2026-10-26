# Kanban Embed

Shows a Kanban board inside any note, read from the board file, with live updates, lane picking and card check-off.

The board stays one Markdown file.

<img src="https://raw.githubusercontent.com/theluckystrike/kanban-embed/HEAD/docs/kanban-embed.gif" alt="Open the project page, check off a card, then move a card to Review" width="720">

## Features

### A board inside any note

Add a `kanban-embed` code block with the board name. The block shows the lanes side by side, with the board name as a link. Each lane shows its card count. A lane with a card limit, such as `## In progress (3)`, shows `4/3` and gets a warning border when it is over the limit.

Cards show their links, tags and formatting; a date such as `@{2026-10-14}` shows as a chip. A priority tag on a card gives it a colored left border and a chip: `#high`, `#urgent` or `#p1` for red, `#medium`, `#med` or `#p2` for orange, and `#low` or `#p3` for blue. With two priority tags, the higher one wins. The match ignores case. The block works in Reading view and in Live Preview.

<img src="https://raw.githubusercontent.com/theluckystrike/kanban-embed/HEAD/docs/board-in-note.png" alt="The Website redesign board embedded in a project page, with four lanes and the over-limit lane" width="720">

### Pick lanes and hide done cards

Add `lanes: In progress, Review` to show only those lanes, in that order. Add `hide-done: true` to hide checked cards; the header says how many are hidden. A lane name that the board lacks shows a warning.

<img src="https://raw.githubusercontent.com/theluckystrike/kanban-embed/HEAD/docs/pick-lanes.png" alt="A standup note that shows only the In progress and Review lanes, with done cards hidden" width="720">

### Check off cards and live update

Select the checkbox of a card to check or uncheck it. Only the lines of that card change, plus the next copy of a recurring Tasks task.

When the Tasks plugin is on, a card that you check gets the Tasks done date, such as `✅ 2026-10-10`, and loses it when unchecked. Kanban Embed hands the card line to Tasks, so recurring tasks and the date format follow your settings. Without Tasks the card gets a plain `[x]`.

When the board file changes, in the Kanban plugin or after a sync, the embeds of that board draw again. Before a check or a move, the plugin confirms that the card line still matches the screen, or it does not write.

<img src="https://raw.githubusercontent.com/theluckystrike/kanban-embed/HEAD/docs/check-off.png" alt="A checked card in the embed, with the same card checked in the board file" width="720">

### Move cards (Pro)

Drag a card to another lane, or to another place in the same lane. On a touch screen, use the card menu, "Move to", and a lane. A card that moves into a lane with the `**Complete**` marker gets checked, with the Tasks done date when Tasks is on; a card that moves out of one loses the date.

<img src="https://raw.githubusercontent.com/theluckystrike/kanban-embed/HEAD/docs/move-cards.png" alt="The card menu with the Move to items for the other lanes" width="720">

### Add cards (Pro)

Select "Add a card" at the bottom of a lane, type the text and press Enter to add it at the end of the lane; Escape cancels.

<img src="https://raw.githubusercontent.com/theluckystrike/kanban-embed/HEAD/docs/add-card.png" alt="The add card field at the bottom of the Backlog lane" width="720">

### Several boards in one embed (Pro)

List more than one board, such as `board: [[Website redesign]], [[Mobile app]]`. Lanes with the same name become one column. Each card shows the name of its board, and moves stay inside that board.

<img src="https://raw.githubusercontent.com/theluckystrike/kanban-embed/HEAD/docs/several-boards.png" alt="The In progress and Review lanes of two boards merged into one embed" width="720">

### Card filter (Pro)

Add a line such as `filter: #design` or `filter: login #dev`; a card must have each word to show. A word with `#` must be a tag of the card; `#design` also matches `#design/web`.

<img src="https://raw.githubusercontent.com/theluckystrike/kanban-embed/HEAD/docs/filter.png" alt="Only the cards tagged design from both boards" width="720">

### Swimlanes (Pro)

Add `swimlane: #project/` to group the cards into rows. Each row is one project tag, such as `#project/launch`, and the lanes stay as columns. Select a row header to fold or open it; the plugin remembers folded rows.

Other forms are `swimlane: tag` (the first tag of each card), `swimlane: #now, #next, #later` (these rows in this order) and `swimlane: @{owner}` (one row for each value of a card field such as `[owner:: Ana]`). Cards without a value go to an Unassigned row; a drop on another row does nothing, and "Add a card" in a row adds that row's tag or field.

<img src="https://raw.githubusercontent.com/theluckystrike/kanban-embed/HEAD/docs/swimlanes.png" alt="The Team sprint board in two rows, launch and pricing, with the lanes as columns and a folded row" width="720">

## Install

Open Settings, then Community plugins, then Browse, and search for "Kanban Embed". Select Install, then Enable.

To install by hand, download `main.js`, `manifest.json` and `styles.css` from the latest release and put them in `<vault>/.obsidian/plugins/kanban-embed/`. Reload the community plugins, then turn on Kanban Embed.

## Usage

Put the cursor where the board should go, run the command "Insert a board embed" and pick a board. It inserts this block:

~~~markdown
```kanban-embed
board: [[Website redesign]]
```
~~~

The lines a block can have:

| Line | What it does |
| --- | --- |
| `board: [[Name]]` | The board to show. Also `boards:`. More than one board is Pro. |
| `lanes: A, B` | Show only these lanes, in this order. Also `lane:`. |
| `hide-done: true` | Hide checked cards. `false` overrides the setting. |
| `filter: words` | Only cards with each word. `#tag` words match tags. Pro. |
| `swimlane: value` | Rows across the lanes: `tag`, `#prefix/`, `#a, #b` or `@{field}`. Also `rows:`. Pro. |
| `title: Text` | Header text instead of the board name. |

The board name works like a link, so `[[Website redesign]]` finds the note anywhere in the vault. An unknown block line shows a warning.

## Pro

The free version shows one board per embed, with lane picking, hidden done cards, check-off and live update, and has no time or card limit.

Pro adds moving and adding cards, several boards in one embed, the card filter and swimlane rows. To get it:

1. Sponsor [theluckystrike on GitHub Sponsors](https://github.com/sponsors/theluckystrike) with $5 a month, or $15 once.
2. In Obsidian, open the settings of Kanban Embed and select "Sign in with GitHub".
3. Paste the code the plugin shows at github.com/login/device and approve. If you sponsor after you sign in, select Refresh.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

| Setting | What it does |
| --- | --- |
| Pro | Sign in, status, Refresh and Sign out. |
| Lane width | Width of one lane in pixels, from 180 to 480. The default is 240. |
| Hide done cards | Hide checked cards in embeds that have no `hide-done` line. |

<img src="https://raw.githubusercontent.com/theluckystrike/kanban-embed/HEAD/docs/settings.png" alt="The settings tab with the Pro section, lane width and hide done cards" width="720">

## FAQ

### Do I need the Kanban plugin?

No. Kanban Embed reads the board file itself.

### Does Kanban Embed change my board files?

Only when you check, move or add a card. A check or a move edits only the lines of that card.

### Does it work on a phone or tablet?

It is not marked desktop only, but the tests run on desktop. On a touch screen, move cards with the Move to menu.

### Which board format does it read?

The Markdown format of the Kanban plugin: `kanban-plugin: board` in the frontmatter, one heading per lane and one list item per card. Archived cards do not show. Headings and list items inside fenced code are ignored. A code fence closes only with the same marker, at least as long as the opening one.

### How is this different from an embed with `![[Board]]`?

A normal embed shows the board as plain Markdown, not as lanes side by side.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Kanban Embed makes no network requests. Sign in uses the GitHub device flow. Kanban Embed sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Kanban Embed sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Report a bug or a feature request in the issue tracker. To support the work, use [GitHub Sponsors](https://github.com/sponsors/theluckystrike).

```
npm ci
npm run build
npm test
```

## License

MIT

## Community

Questions, bugs or plugin ideas? Talk to me and other Obsidian users in [Zovo Chat](https://t.me/+k2MM-BIc7SQ5OWM0) on Telegram. It has a topic for these plugins. You can also open an issue here.
