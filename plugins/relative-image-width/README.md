# Relative Image Width

Relative Image Width lets you size an embedded image with percent, em, rem, vw and vh, in the link that you already write. Obsidian reads `![[photo.png|300]]` as 300 pixels, and nothing else. A pixel width that looks right on a laptop is too wide on a phone. With this plugin, `![[photo.png|50%]]` is half the text column on every screen, in Live Preview and in Reading view.

The plugin answers the forum request "Image resize: Allow relative units, not just pixels (or Pandoc notation)". It reads the forms from that request: `![[image.png|50%]]`, `![[image.png|50%x50%]]`, `![[image.png|70em]]`, `![[image.png|70rem]]`, and, as a setting, a Pandoc attribute block such as `{width=50%}` after the link.

## Features

### Relative sizes in the image link

Put the size as the last part of the link. The animation shows the same note with the plugin off, then on.

<img src="https://raw.githubusercontent.com/theluckystrike/relative-image-width/HEAD/docs/relative-image-width.gif" alt="A note with four images: first each image fills the column, then the plugin sizes them at 50 percent, 25 percent, 12 rem and 200 pixels" width="720">

These forms work:

| You write | The image is |
| --- | --- |
| `![[photo.png\|50%]]` | half the width of the text column |
| `![[photo.png\|50%x30%]]` | half the column wide and 30% of the window high, with its aspect ratio kept inside that box |
| `![[photo.png\|70em]]` | 70 times the font size of the text |
| `![[photo.png\|20rem]]` | 20 times the root font size of the app |
| `![[photo.png\|40vw]]` | 40% of the window width |
| `![[photo.png\|Sunset\|25%]]` | a quarter of the column, with the caption "Sunset" as its alt text |

The Markdown image form takes the size after the alt text:

```
![Sunset|50%](photo.png)
```

A number is from more than 0 to 10000, with or without decimals. A size wider than the text column stops at the column, as a natural image does. You can mix units: `50%x120` is half the column wide and 120 pixels high.

Free: all of the forms above in Live Preview and Reading view, and the Pandoc attributes. Pro: a default size for images without a size, and a note property. $15 one time or $5 a month: [Sponsor](https://github.com/sponsors/theluckystrike?metadata_source=relative-image-width).

### What Obsidian does without it

Without the plugin, Obsidian ignores a size that is not a pixel number. Each image in the note below fills the text column, and only the pixel size works.

<img src="https://raw.githubusercontent.com/theluckystrike/relative-image-width/HEAD/docs/without-plugin.png" alt="Live Preview without the plugin: the images with relative sizes all fill the text column" width="720">

### Live Preview

In Live Preview, each image shows at its size while you write. Put the cursor on the line of the link, and you see the link text to edit it, as usual. The pixel size `![[photo.png|200]]` stays exactly as Obsidian draws it. The plugin sets nothing on that image.

<img src="https://raw.githubusercontent.com/theluckystrike/relative-image-width/HEAD/docs/live-preview.png" alt="Live Preview with the plugin: images at 50 percent, 25 percent and 12 rem of the column" width="720">

### Reading view

Reading view shows the same sizes, also for images in a table cell (write `\|` before the size there, as Obsidian needs for any `|` in a table).

<img src="https://raw.githubusercontent.com/theluckystrike/relative-image-width/HEAD/docs/reading-view.png" alt="Reading view with the same three relative sizes and the pixel image" width="720">

### Pandoc attributes

Turn on "Read Pandoc attributes" in the settings to read a Pandoc attribute block directly after an image link, with no space between them:

```
![Sunset](photo.png){#fig-sunset .wide width=50% height=30%}
![[photo.png]]{width=20rem}
```

The plugin reads `width`, `height`, one `#id` and `.class` names. A bare number is pixels, as in Pandoc. Reading view hides the block. Live Preview hides it when the cursor is not on its line. The setting is off by default, so notes that have other text in braces after an image do not change.

<img src="https://raw.githubusercontent.com/theluckystrike/relative-image-width/HEAD/docs/pandoc.png" alt="Reading view: an image sized by a Pandoc width of 30 percent, with the attribute block hidden" width="720">

### Default size for a note (Pro)

With Pro, you can give every image that has no size in its link a default size, for example `100%` or `40rem`. The note property `image-width` sets the default for one note and wins over the setting. A size in the link wins over both. Without Pro, a change of the setting, or the property in the open note, shows a Sponsor on GitHub notice. The images keep their size.

<img src="https://raw.githubusercontent.com/theluckystrike/relative-image-width/HEAD/docs/default-size.png" alt="Reading view of a note with the property image-width set to 40 percent: the image without a size shows at 40 percent of the column" width="720">

## Install

1. Open "Settings → Community plugins" and turn off restricted mode.
2. Select "Browse", search for "Relative Image Width", then select "Install" and "Enable".

To install by hand, copy `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/relative-image-width/`. Then enable the plugin. You need Obsidian 1.13.4 or later.

## Usage

There is nothing to set up.

1. Embed an image as usual.
2. Add `|` and a size with a unit as the last part: `![[photo.png|50%]]`, or after the alt text of a Markdown image.
3. Read the note in Live Preview or Reading view.

The plugin never writes to your notes. It only changes how the image looks. A link without a unit, such as `|300`, is pixels, and Obsidian sizes it as before. A size with an unknown unit, a space between the number and the unit, a 0 or a number above 10000 is not a size. Obsidian then shows that text as the alt text of the image, as it does today.

The plugin sizes image embeds only. A note embed or a PDF embed with `|50%` stays as Obsidian draws it. Images inside callouts and embedded notes use the same sizes. A percent height means a percent of the window height, because a web page ignores a percent height in a block that has no fixed height.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

| Setting | What it does |
| --- | --- |
| Read Pandoc attributes | Sizes an image from a `{width=...}` block after its link, and hides the block. Off by default. |
| Default image size | Pro. The size of each embedded image with no size in its link. Empty by default. |

<img src="https://raw.githubusercontent.com/theluckystrike/relative-image-width/HEAD/docs/settings.png" alt="The settings tab with Read Pandoc attributes, the default image size and the Pro section" width="720">

## Pro

To sign in and enable Pro:

1. Sponsor via [GitHub Sponsors](https://github.com/sponsors/theluckystrike?metadata_source=relative-image-width). A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply.
2. In Obsidian, open the settings of Relative Image Width and select "Sign in with GitHub".
3. The plugin copies a code and opens github.com/login/device. Paste the code there and approve.

If you sponsor after you sign in, select Refresh. A negative sponsorship answer turns Pro off.

## FAQ

### Does it change my notes?

No. The link stays as you wrote it. Open and close a note, and the file is the same, byte for byte.

### What happens if I turn the plugin off?

The images show at their natural size, limited by the text column, as Obsidian draws a size that it does not know. Pixel sizes do not change. Turn the plugin on again, and the sizes come back.

### Why does my image not get smaller?

Check that the size is the last part of the link, with no space between the number and the unit: `50%`, not `50 %`. An image cannot be wider than the text column.

### Does Obsidian Publish show the sizes?

No. Publish does not run community plugins.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Relative Image Width makes no network requests. Sign in uses the GitHub device flow. Relative Image Width sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Relative Image Width sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Plugin page: [relative-image-width](https://notemods.com/plugins/relative-image-width/).

Report bugs and ask for features in the GitHub issues of this repository. Add your Obsidian version and a small sample note.

## Community

Questions, bugs or plugin ideas? Talk to me and other Obsidian users in [Zovo Chat](https://t.me/+k2MM-BIc7SQ5OWM0) on Telegram. It has a topic for these plugins. You can also open an issue here.
