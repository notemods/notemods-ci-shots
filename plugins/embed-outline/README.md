# Embed Outline

Embed Outline shows one outline for a note and the notes it embeds. Each embedded note has its own row, with its headings below it. The outline also shows callout titles and headings in list items.

The basic outline is free. Pro adds nested embeds, word counts, broken embed marks and a Markdown copy. It costs $5 a month or $15 once through GitHub Sponsors.

## Features

<img src="https://raw.githubusercontent.com/theluckystrike/embed-outline/HEAD/docs/embed-outline.gif" alt="The outline of a manuscript note with its embedded chapters, a click into a chapter, then word counts with Pro" width="720">

Pro costs $15 one time or $5 a month: [Sponsor](https://github.com/sponsors/theluckystrike?metadata_source=embed-outline) or [$15 one-time offer](https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=embed-outline).

### Embedded notes in the outline

<img src="https://raw.githubusercontent.com/theluckystrike/embed-outline/HEAD/docs/embedded.png" alt="A manuscript note on the left and, on the right, an outline with a row for each embedded chapter and the chapter headings under it" width="720">

Each embedded note gets a row with the note name and its headings below it. The row sits under the heading that holds the embed.

A section embed, such as `![[Chapter 4#The storm]]` or `![[#Summary]]`, shows only that section's headings. A block embed such as `![[Note#^quote]]` gets a row with no headings below it. Images, PDFs and other files are left out.

### Jump to any row

<img src="https://raw.githubusercontent.com/theluckystrike/embed-outline/HEAD/docs/jump.png" alt="The manuscript scrolled to the heading A letter in the drawer inside the embedded Chapter 2" width="720">

Click a heading of your note and the cursor moves to that heading. Click a heading of an embedded note and the note scrolls to the embed, then to that heading inside the embed. In reading view the page scrolls to the same place.

Hold Ctrl (Cmd on macOS) and click a row from an embedded note to open that note in a new tab, at that heading. Rows also work from the keyboard: move to a row with Tab and press Enter.

The arrow at the start of a row folds it. The button at the top folds all top-level rows.

While the panel stays open, it remembers the folds of up to 20 notes, so a note you return to keeps its folds. Inserting an unrelated heading keeps the existing folds. Closing the panel clears this memory. Renaming a heading can reset its fold.

### Callouts and headings in lists

<img src="https://raw.githubusercontent.com/theluckystrike/embed-outline/HEAD/docs/callouts.png" alt="A research note with info, question and warning callouts listed as rows under their headings, and a heading written inside a list item" width="720">

A callout such as `> [!warning] Spring tides` shows as a row with its title, under the heading it sits in. A callout with no title shows its type, as the app does. Links and emphasis in a title show as plain text.

A heading written inside a list item, such as `- ## Open questions`, is also a row. The app does not treat these as headings, so the core Outline never shows them. You can turn both off in the settings.

### Search the outline

<img src="https://raw.githubusercontent.com/theluckystrike/embed-outline/HEAD/docs/search.png" alt="A search for ferry shows the matching heading in Chapter 1 and its parent rows" width="720">

Type in "Search outline" to find a heading, callout title, list heading or embed name. Search is free and ignores case and spaces at the start and end. Punctuation is literal text. Search checks the row text that the panel shows.

The panel shows each match and its parent rows. The count includes matches only. Folded paths open during search. Use the clear button or Escape to restore the full outline and its fold state. Fold controls are off during search.

Click a result, or press Enter, to go to it. The query stays during updates and clears when you open another note. Search includes the deeper embeds that Pro opens. Word counts and the Markdown copy use the full outline.

### Nested embeds (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/embed-outline/HEAD/docs/nested.png" alt="The outline with the letter that Chapter 2 embeds open one level deeper, with its two headings" width="720">

Without Pro, the outline opens the embeds of the note itself. An embed inside an embedded note shows as a row with a lock, and a line at the top says how many there are. Pro opens them down to 5 levels. Set the depth in the settings.

### Word counts (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/embed-outline/HEAD/docs/word-counts.png" alt="The outline with a word count on each heading and embed, and 439 words for the whole manuscript at the top" width="720">

Pro shows a word count next to each heading and embed. The count of a heading covers its whole section, with the embedded text counted. The top of the panel shows the total for the note.

Links count as their visible text. Code, comments, front matter, URLs and callout markers do not count. Each Chinese or Japanese character counts as one word.

### Broken embeds (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/embed-outline/HEAD/docs/broken.png" alt="The end of the outline with a red row No such note: Acknowledgments under Back matter" width="720">

Pro marks embeds with missing notes, headings or block IDs. It also marks loops, such as two notes that embed each other. The panel counts them. Without Pro, these embeds are left out.

### Copy as a Markdown list (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/embed-outline/HEAD/docs/copy.png" alt="A new note with the outline pasted as a nested list of links to each heading, with word counts" width="720">

The copy button, or the command "Copy the outline as a Markdown list", puts the outline on the clipboard. Each heading becomes a link to the note it comes from, such as `[[Chapter 1#The ferry|The ferry]]`, with the word count when counts are on. Paste it into a note for a linked table of contents of the whole book.

## Install

Open Settings, then Community plugins, then Browse, and search for "Embed Outline". Select Install, then Enable.

To install by hand, download `main.js`, `manifest.json` and `styles.css` from the latest release. Put them in `<vault>/.obsidian/plugins/embed-outline/`. Reload the community plugins, then turn on Embed Outline.

It needs Obsidian 1.13.4 or newer. It was tested on desktop with Obsidian 1.13.4 and 1.14.4, not on mobile.

## Usage

1. Turn on the plugin. The outline gets a tab in the right sidebar.
2. Open a note that embeds other notes.
3. Select the Embed outline tab, or run the command "Open the outline panel".
4. Click a row to go to it.

The outline follows the last open note and updates after it or an embed changes.

## Pro

To get Pro:

1. Sponsor through [GitHub Sponsors](https://github.com/sponsors/theluckystrike?metadata_source=embed-outline). A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply.
2. In settings, select "Sign in with GitHub" and enter the code at github.com/login/device.

Refresh after a new sponsorship. Without Pro, the free outline keeps working.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

<img src="https://raw.githubusercontent.com/theluckystrike/embed-outline/HEAD/docs/settings.png" alt="Settings with the Pro section, the two outline switches, the embed depth slider and the two Pro switches" width="720">

| Setting | Default | Allowed values |
| --- | --- | --- |
| Callout titles | On | On or off |
| Headings in list items | On | On or off |
| Embed depth | 5 | 1 to 5 levels (Pro) |
| Word counts | On | On or off (Pro) |
| Broken embeds | On | On or off (Pro) |

## FAQ

### Does it replace the core Outline?

No. Both can be open at the same time. Embed Outline only reads your notes and never changes them.

### Is it slow on a long book?

It reads the open note and the notes it embeds, from the cache of the app, and nothing else in the vault. It stops at 400 notes and 5,000 rows, and word counts stop after 20,000 embedded parts. A line at the top tells you when the note, row or word limit applies.

### Why does a row say "No such heading" when the embed shows in the note?

The heading text must match after the app removes special characters such as `:` and `#`. Check for a renamed heading.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Embed Outline makes no network requests. Sign in uses the GitHub device flow. Embed Outline sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Embed Outline sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Plugin page: [embed-outline](https://notemods.com/plugins/embed-outline/).

Report bugs and feature requests in the issue tracker. Include your Obsidian version, the embed as written and what the outline showed.

To build from source:

```
npm ci
npm run build
npm test
```

The tests check 34 golden cases for the outline and search rules, and an end-to-end run in Obsidian.

## License

MIT

## Community

Questions, bugs or plugin ideas? Talk to me and other Obsidian users in [Zovo Chat](https://t.me/+k2MM-BIc7SQ5OWM0) on Telegram. It has a topic for these plugins. You can also open an issue here.
