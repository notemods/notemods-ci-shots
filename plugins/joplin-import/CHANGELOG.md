# joplin-import

## 1.0.3

### Patch Changes

- A note or notebook name now keeps at most 80 characters and at most 200 UTF-8 bytes, and the cut keeps each Unicode code point whole. A note with a long Chinese, Japanese or emoji title now gets a file name of 255 bytes or less, the limit of common Linux file systems. Before, the import of such a note failed on Linux. The preview of an archive with many missing links and the audit of large archives no longer stop the app for several seconds. When the plugin is turned off during an import or a resync, it writes no more files and no report.
- An image inside a link, as the Joplin web clipper writes it, now becomes a Markdown image inside a Markdown link, and a Joplin note link around it becomes a link to the imported note. Before, the note showed a "!" link and source text. An HTML image tag with a Joplin resource that has a file now becomes an embed with its width, if set. A tag without a file stays and the report lists it. A line such as ```` ```js``` ```` no longer starts a code block, so the links after it convert. After the cut, a name loses dots and spaces at its end, and a reserved Windows name such as CON gets "_" after the reserved part. When a folder cannot be created, the report names it, its notes and attachments are skipped, and the import goes on with the other folders. A notebook below level 64 uses the folder of its level-64 parent, and the report names it. The preview of a chain of 2000 notebooks now takes less than 1 second.

## 1.0.2

### Patch Changes


## 1.0.1

### Patch Changes

