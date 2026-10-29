# Joplin Export Import

Import a Joplin JEX archive into your vault as Markdown notes. Notebooks become folders, supported Joplin links become vault links, and local resources become attachments. Imported notes keep their source ID and usable tags in their properties. Valid source dates become the created and updated properties. Check the preview before the import.

The plugin reads the archive on your device and does not change it. The import needs no account and no network connection. The screenshots show sample notes.

<img src="https://raw.githubusercontent.com/theluckystrike/joplin-import/HEAD/docs/import-flow.gif" alt="Preview a Joplin archive, import it, then read a linked note and a note with an embedded sample image" width="720">

## Features

### Preview the archive before a write

Select a `.jex` file that is in your vault and an output folder. The preview shows the count of notes, notebooks, tags and resources in the archive, the count of new notes and attachments, and the count of existing paths that the import will skip. It shows the first output paths and lists missing resources, missing note links, unsupported items, changed tag names and notebook problems.

The preview converts the notes in memory and writes nothing. If you close the window without Import, the plugin creates no folder and no file. Import creates new files only: it checks each output path just before the write and skips a path that exists. With "Write a report note" on, the report gives counts, errors, missing resources and unsupported items.

The plugin rejects an archive with an absolute member path, a `..` part, a symbolic or hard link, a device, two members with the same name, or a damaged header. This check runs when the plugin reads the archive, before the first write.

<img src="https://raw.githubusercontent.com/theluckystrike/joplin-import/HEAD/docs/preview.png" alt="The import window with the archive counts, the output paths and the report lists" width="720">

### Notebooks as folders, links as vault links

Each notebook becomes a folder inside the output folder, and a sub-notebook becomes a sub-folder. A note in notebook Work with the title Plan becomes `Work/Plan--<source id>.md`. The Joplin ID keeps notes with the same title apart. A long name is cut to 80 characters and 200 UTF-8 bytes. With the same note title and notebook path, a later import finds the same file.

A Joplin note link such as `[Other](:/<note id>)` becomes `[[<output folder>/Work/Other--<note id>|Other]]`, so the label stays. A heading anchor after the ID stays in the link. Links inside fenced code blocks stay as they are.

Each new imported note gets these properties: `title`, `joplin_id`, `created` and `updated` when valid dates are in the archive (ISO values from the archive, not the import time), `tags`, `joplin_todo` for to-do notes, and `joplin_hash`. When the archive has the user-set dates of the Joplin app, the plugin uses them. The note body stays as it is in Joplin, except for the converted links.

<img src="https://raw.githubusercontent.com/theluckystrike/joplin-import/HEAD/docs/note-links.png" alt="An imported note with vault links to two other notes, the Research tag and the source dates" width="720">

### Local attachments

The import copies resources with metadata and file bytes to `<output folder>/_resources/<resource id>`, with an extension when present. An embed such as `![Photo](:/<resource id>)` becomes `![[<path>|Photo]]`. A link to a PDF or another file becomes a plain vault link.

When a resource has no file in the archive, the source link stays as it is and the report names the resource. The other notes import as usual.

<img src="https://raw.githubusercontent.com/theluckystrike/joplin-import/HEAD/docs/attachment.png" alt="An imported note with the embedded coast image and the missing tram image" width="720">

### Resync changed notes (Pro)

Put a newer `.jex` file in the vault, select it with the same output folder, select Preview and then "Preview changes". The list shows the imported notes that have a different text in the new archive. A note that you changed in the vault after the import is listed as edited and stays unchanged. Select "Update N notes" to write the changed notes. The plugin uses the `joplin_hash` property to find notes that you edited.

Resync updates notes at the same output paths. It does not delete or create notes or copy attachments. Use Import for new notes and attachments before resync.

<img src="https://raw.githubusercontent.com/theluckystrike/joplin-import/HEAD/docs/resync.png" alt="The Pro resync list of changed notes from a later archive" width="720">

### Audit several archives (Pro)

Select two or more `.jex` files in the import window and select "Write audit". The plugin writes one note into the output folder. It has a table with one row for each archive: notes, HTML notes, note links, resource links, resolved links, link targets that are in a different selected archive, missing targets and unused resources. Lists below the table name each problem and the notes that are in more than one archive.

<img src="https://raw.githubusercontent.com/theluckystrike/joplin-import/HEAD/docs/audit.png" alt="The Pro audit note with a table for two archives" width="720">

## Install

For manual installation, copy `main.js`, `manifest.json` and `styles.css` from a release into `<vault>/.obsidian/plugins/joplin-import/`. Enable the plugin in Community plugins. Obsidian 1.13.4 or later is necessary.

## Usage

1. In Joplin, select File, Export all, JEX.
2. Copy the `.jex` file into your vault.
3. Run the command `Joplin Export Import: Import a Joplin archive`, or right-click the `.jex` file in the file list and select "Import this Joplin archive".
4. Select the archive and type the output folder. The default is `Joplin import`.
5. Select Preview. Read the counts and open the report lists.
6. Select Import. The status line shows the counts of created notes, created attachments, skipped paths and errors. It shows the report path when reports are on.

## Settings

- Output folder: the default folder for imported notes and attachments. You can change it in the import window.
- Write a report note: on by default.
- Pro: sign in with GitHub, see the sponsorship status and refresh it.

## FAQ

### Which notes does the plugin import?

Notes with a Markdown body. Joplin can also keep a note as HTML, for example a web clip. This version does not convert HTML notes; the report lists each one. Encrypted items and note history are not imported. The report lists encrypted items and gives the count of revision items.

### What happens to Joplin tags?

Tag names go into the `tags` property. Obsidian tags cannot have spaces, so a space becomes a hyphen and the report names the change. If the converted tag is empty or contains digits only, it is not written and the report names it.

### How large can an archive be?

The limit is 100 MiB for the `.jex` file. The plugin checks the file size before it reads the file. For a larger collection, export some notebooks at a time and import each file into the same output folder.

### What did you test?

Unit tests (82 tests) run 27 golden vectors through the reader and converter. Vault tests check previews, reports, repeat import, unsafe archives, size checks, Pro guards, resync, audit, concurrent edits, code fences, dates, long Chinese titles, 20,000 notes and an unload during an import. End-to-end tests pass on Obsidian 1.13.4 and 1.14.4, and on 1.14.4 in mobile emulation: 11 tests on each. They check import, links, attachments, properties, Reading view, Pro actions and plugin reload. Pro tests use a fixed GitHub answer and make no GitHub request.

We did not test a JEX file made by the Joplin app. The test archives use the Joplin item format, and the test tar writer makes them. The mobile emulation is not a real phone. We did not test a real phone or tablet, an archive near the size limit, HTML `<img>` tags with Joplin resource IDs, a live payment or a live GitHub sign in.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Joplin Export Import makes no network requests. Sign in uses the GitHub device flow. Joplin Export Import sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Joplin Export Import sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Report a problem in the repository issues with the app version and the error text. Remove private note text before you share an archive. Publisher: theluckystrike. License: MIT.
