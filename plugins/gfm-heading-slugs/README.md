# GFM Heading Slugs

GFM Heading Slugs makes Obsidian read heading links the way GitHub writes them. On GitHub, the heading `## Setup steps` has the anchor `#setup-steps`, and a table of contents links to it with `[Setup steps](#setup-steps)`. Obsidian expects `#Setup%20steps` and shows "Unable to find selection" for the GitHub form. With this plugin, both forms open the heading. Each heading in Reading view gets its GitHub slug as its `id`, and a heading link that you insert gets the slug in its target. Your notes stay readable on GitHub, Bitbucket, VS Code and Obsidian.

## Features

### Open GitHub-style heading links

<img src="https://raw.githubusercontent.com/theluckystrike/gfm-heading-slugs/HEAD/docs/gfm-heading-slugs.gif" alt="A click on a GitHub-style heading link, first without the plugin with the core notice, then with the plugin, which moves to the heading" width="720">

A link like `[Setup steps](#setup-steps)` opens the heading `## Setup steps` of the same note. A link like `[Install guide](Other%20note.md#install-guide)` opens the heading in the other note. In Live Preview, a click opens the link. In Source mode, hold Ctrl or Cmd and click, as for other links. Ctrl or Cmd click opens a new tab, as in core.

When two headings have the same text, GitHub adds `-1`, `-2` to the later ones. The plugin uses the same rule, so `#hello-world-1` opens the second `## Hello World`. Links in the Obsidian form, like `#Setup%20steps`, keep working.

### The core notice that it replaces

<img src="https://raw.githubusercontent.com/theluckystrike/gfm-heading-slugs/HEAD/docs/without-plugin.png" alt="Live Preview without the plugin, with the core notice Unable to find selection after a click on a GitHub-style link" width="720">

Without the plugin, Obsidian looks for a heading with the text `setup-steps`, finds none and shows the notice.

### Live Preview

<img src="https://raw.githubusercontent.com/theluckystrike/gfm-heading-slugs/HEAD/docs/live-preview.png" alt="Live Preview after the click, with the Setup steps heading at the top of the view" width="720">

The plugin reads only the line that you click. It finds the link under the pointer, computes the slugs of the target note from the Obsidian metadata cache and asks core to open the heading.

### Heading ids in Reading view

<img src="https://raw.githubusercontent.com/theluckystrike/gfm-heading-slugs/HEAD/docs/reading-view.png" alt="Reading view after a click on the link to the second Hello World heading" width="720">

In Reading view and in PDF export, each heading gets its GitHub slug as its `id` attribute. A heading `## What's new?` gets `id="whats-new"`. Each link with a slug target also gets the Obsidian target, so the core page preview on hover works for it.

The end-to-end test compares the ids in a real Obsidian with the ids that GitHub gives the same headings.

### Copy a GitHub-style link

<img src="https://raw.githubusercontent.com/theluckystrike/gfm-heading-slugs/HEAD/docs/copy-link.png" alt="The notice after the copy command, with the link text Setup steps and the target setup-steps" width="720">

The command "Copy GitHub-style link to the current heading" copies a link to the nearest heading at or above the cursor. For the cursor under `## Setup steps`, the clipboard gets `[Setup steps](#setup-steps)`. Paste it in a table of contents. It works on GitHub and in Obsidian.

### Convert old links in a note

<img src="https://raw.githubusercontent.com/theluckystrike/gfm-heading-slugs/HEAD/docs/convert.png" alt="The preview modal of the convert command with three rows, each with the old and the new link target" width="720">

The command "Convert heading links in this note to GitHub slugs" finds markdown links whose target is a heading in the Obsidian form, like `#Team%20notes%202026` or `Project%20guide.md#Install`. A preview lists each change with its line. Select Convert to write all of them in one edit. One undo reverts all of them. Links that already use a slug, links to a heading that does not exist, wikilinks and links in code stay as they are.

With Pro, the command "Convert heading links in all notes to GitHub slugs" shows the number of changes for each note, then writes each note once. It makes the plan again from the text on disk, so an edit made after the preview is not lost.

### Slugs in inserted links

When an edit inserts a whole heading link in one step, the plugin writes the slug in the same edit. This covers a link from the link suggestions with markdown links on, a paste and a drag. `[Team notes](#Team%20notes%202026)` becomes `[Team notes](#team-notes-2026)`. One undo removes the link. Typing a link one character at a time is not changed. Turn this off in the settings.

<img src="https://raw.githubusercontent.com/theluckystrike/gfm-heading-slugs/HEAD/docs/inserted-link.png" alt="A line with an inserted link whose target is the slug team-notes-2026" width="720">

## Install

When GFM Heading Slugs is listed in the community directory, open Settings, then Community plugins, then Browse, and search for "GFM Heading Slugs". Select Install, then Enable.

To install by hand, download `main.js`, `manifest.json` and `styles.css` from the latest release. Put the three files in `<vault>/.obsidian/plugins/gfm-heading-slugs/`. Restart Obsidian or reload the list of community plugins, then turn on GFM Heading Slugs. You need Obsidian 1.13.4 or later.

## Usage

There is nothing to set up. Open a note with GitHub-style heading links and click one.

1. Write a heading, for example `## Setup steps`.
2. Link to it with `[Setup steps](#setup-steps)`, or run the copy command under the heading.
3. Click the link in Live Preview or Reading view.

To move a set of notes from the Obsidian form to the GitHub form, open each note and run the convert command. With Pro, run the vault-wide command once.

The slug rule is the rule of GitHub. Lower case. Remove each character that is not a letter, a mark, a digit, an underscore, a hyphen or a space. Change each space to a hyphen. The text is the text that GitHub shows, so `**Bold**` counts as `Bold`, and the text of a code span stays. The golden test vectors hold 56 headings with the ids from the GitHub Markdown API, with accents, Cyrillic, Greek, Japanese, emoji, punctuation, code spans and duplicates.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

| Setting | What it does |
| --- | --- |
| Use GitHub slugs for heading anchors | On by default. Off turns off every feature of the plugin. |
| Write slugs in inserted links | On by default. Writes the slug in a heading link that one edit inserts. |

<img src="https://raw.githubusercontent.com/theluckystrike/gfm-heading-slugs/HEAD/docs/settings.png" alt="The settings tab with the two settings first and the Pro section below them" width="720">

## Pro

To sign in and enable Pro:

1. Sponsor via [GitHub Sponsors](https://github.com/sponsors/theluckystrike?metadata_source=gfm-heading-slugs). A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply.
2. In Obsidian, open the settings of GFM Heading Slugs and select "Sign in with GitHub".
3. The plugin copies a code and opens github.com/login/device. Paste the code there and approve.

If you sponsor after you sign in, select Refresh. A negative sponsorship answer turns Pro off.

## FAQ

### Does it change my notes?

Only when you ask. Opening and reading a note writes nothing. The convert commands write after you select Convert. The inserted link rewrite changes only the link that the same edit inserts.

### Do headings in Live Preview get an id?

No. Live Preview draws the note as editor lines, not as rendered HTML. Reading view and PDF export get the ids. Links work in both modes.

### Does the hover preview work for slug links?

In Reading view, yes, through the core page preview. In Live Preview, the hover preview is not part of this version.

### What about wikilinks?

GitHub does not read wikilinks, so the plugin leaves them as they are. Use markdown links for notes that you share.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, GFM Heading Slugs makes no network requests. Sign in uses the GitHub device flow. GFM Heading Slugs sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, GFM Heading Slugs sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Plugin page: [gfm-heading-slugs](https://notemods.com/plugins/gfm-heading-slugs/).

Report bugs and ask for features in the GitHub issues of this repository. Add your Obsidian version and a small sample note.

## Community

Questions, bugs or plugin ideas? Talk to me and other Obsidian users in [Zovo Chat](https://t.me/+k2MM-BIc7SQ5OWM0) on Telegram. It has a topic for these plugins. You can also open an issue here.
