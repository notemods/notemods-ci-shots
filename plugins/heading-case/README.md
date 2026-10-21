# Heading Case

Heading Case rewrites the headings in the open note to sentence case or title case in one step. Body text, properties and code blocks stay as they are.

Notes that you collect over a few years end up with headings in three different styles. Fixing them by hand means retyping each heading and remembering which words to keep. Heading Case does the retyping, and it keeps the words that you tell it to keep.

## Features

### Sentence case in one command

<img src="https://raw.githubusercontent.com/theluckystrike/heading-case/HEAD/docs/before.png" alt="A note whose headings mix three styles" width="720">

<img src="https://raw.githubusercontent.com/theluckystrike/heading-case/HEAD/docs/sentence-case.png" alt="Convert headings to sentence case. GitHub and New York come from the keep list, macOS, iPhone, API and 3D are kept on their own" width="720">

Run "Convert headings to sentence case" and each heading gets a capital on its first word only. A heading like "How To Install The App" becomes "How to install the app". The word after a colon, a question mark or an exclamation mark also gets a capital, so "Setup: First Steps" becomes "Setup: First steps".

### Title case in one command

<img src="https://raw.githubusercontent.com/theluckystrike/heading-case/HEAD/docs/title-case.png" alt="Convert headings to title case. Short words stay lowercase unless they open the heading or follow a colon" width="720">

Run "Convert headings to title case" and each main word gets a capital. Short words stay lowercase: a, an, and, as, at, but, by, en, for, if, in, nor, of, on, or, per, so, the, to, via, vs and yet. They still get a capital when they open or close the heading or follow a colon. So "setting up obsidian: a guide for the new user" becomes "Setting Up Obsidian: A Guide for the New User".

"Up" and "off" are not on the short word list. In headings they are nearly always part of a verb, as in "Setting Up" or "Kick Off". In a hyphenated word, each part gets a capital except short words after the first part. So you get "Step-by-Step" and "In-Depth".

### A keep list for names and brands

<img src="https://raw.githubusercontent.com/theluckystrike/heading-case/HEAD/docs/settings.png" alt="The keep list and the selected lines switch" width="720">

Add names, brands and phrases to the "Words to keep" setting. Heading Case writes them exactly as you typed them, in both modes. The match ignores case, so the list also fixes spelling: with `GitHub` in the list, "github" becomes "GitHub". Phrases work too. With `New York` in the list, "a trip to new york" becomes "A trip to New York" in sentence case.

Some words keep their spelling without the list. These are acronyms such as API and NASA, words with mixed case such as iPhone, macOS and JavaScript, and words with digits such as 3D or 2026. The pronoun "I" and forms like "I'm" and "I've" always get a capital.

### Leaves code, links and tags alone

<img src="https://raw.githubusercontent.com/theluckystrike/heading-case/HEAD/docs/sentence-case.png" alt="Convert headings to sentence case. GitHub and New York come from the keep list, macOS, iPhone, API and 3D are kept on their own" width="720">

Heading Case changes only the words of a heading. It does not touch inline code, wikilinks, link targets, bare URLs, HTML tags, tags such as `#project`, footnote markers, inline math or a block id at the end of the heading. The visible text of a Markdown link is converted, but the URL is not. Headings inside fenced code blocks and inside the properties block are skipped.

### One undo for the whole note

<img src="https://raw.githubusercontent.com/theluckystrike/heading-case/HEAD/docs/heading-case.gif" alt="One command fixes every heading in the note, and one undo brings them back" width="720">

Each command makes all its changes in one edit, so a single undo brings the note back. A notice then tells you what happened, for example "Changed 3 of 5 headings to sentence case." If nothing needs to change, the notice says so, for example "All 5 headings in this note already use title case."

### Work on part of a note

<img src="https://raw.githubusercontent.com/theluckystrike/heading-case/HEAD/docs/selected-lines.png" alt="With text selected, only the headings on the selected lines change" width="720">

Select some lines and run a command. Only the headings on the selected lines change, and the notice says "in the selection" instead of "in this note". You can turn this off with the "Selected lines only" setting. With it off, the command always converts the whole note.

## Install

When Heading Case is listed in the community directory, open Settings, then Community plugins, then Browse, and search for "Heading Case". Select Install, then Enable.

To install by hand, download `main.js`, `manifest.json` and `styles.css` from the latest release. Put the three files in `<vault>/.obsidian/plugins/heading-case/`. Restart Obsidian or reload the list of community plugins, then turn on Heading Case.

Heading Case needs Obsidian 1.13.4 or newer. It works on desktop and on mobile.

## Usage

1. Open the note that you want to fix.
2. Optional: select the lines with the headings that you want to change.
3. Open the command palette and run "Convert headings to sentence case" or "Convert headings to title case".
4. Read the notice. If you do not like the result, undo once.

You can give either command a hotkey in Settings, then Hotkeys. Heading Case sets no default hotkeys.

Heading Case works on headings that start with `#`, from level 1 to level 6. A closing row of `#` signs at the end of a heading is kept.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Words to keep | `Obsidian, Markdown` | Words and phrases written exactly as you type them. Put one per line or separate them with commas. |
| Selected lines only | On | With text selected, change only the headings on the selected lines. |

Empty entries and duplicates in the keep list are ignored. When a longer phrase and a shorter word in the list could both match, the longer phrase wins.

## FAQ

### Why did a name become lowercase?

Sentence case lowercases every word after the first unless it is an acronym, has mixed case, has a digit, or is in your keep list. A name such as "Paris" looks like an ordinary word, so add it to "Words to keep".

### My heading is in all caps. Why did the acronyms change?

When a heading has no lowercase letters at all, Heading Case cannot tell an acronym from a shouted word. It treats every word as an ordinary word. Add the acronyms that you want to keep, such as API, to the keep list.

### Does it change headings that are underlined with === or ---?

No. Only headings that start with `#` are converted.

### Does it change the body of the note?

No. Only heading lines change. Body text, lists, tables, properties and code stay as they are.

### Does it rename links to the heading?

No. If another note links to a heading by its text, that link is not updated. Check such links after a large change.

## Payment, account and network

Heading Case is free and open source. It has no paid features, no license key and no trial. It does not ask you to sign in or create an account. It makes no network requests of any kind, and it has no analytics, telemetry or ads. It reads and edits only the note that is open in the editor, and only when you run a command. Apart from that note, it writes only its own settings file (`data.json` in the plugin folder). The `fundingUrl` in `manifest.json` points to the author's GitHub Sponsors page. A gift there is optional and unlocks nothing.

## Support

Report a bug or ask for a feature in the issue tracker of this repository. Please include your Obsidian version, the heading that came out wrong, the mode you used, and your keep list. To support the work, use [GitHub Sponsors](https://github.com/sponsors/theluckystrike).

To build from source:

```
npm ci
npm run build
npm test
```

The test suite runs 24 golden cases and edits an in-memory editor, including the undo.

## License

MIT
