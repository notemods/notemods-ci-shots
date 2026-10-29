# joplin-import

## 1.0.3

### Patch Changes

- A note or notebook name now keeps at most 80 characters and at most 200 UTF-8 bytes, and the cut keeps each Unicode code point whole. A note with a long Chinese, Japanese or emoji title now gets a file name of 255 bytes or less, the limit of common Linux file systems. Before, the import of such a note failed on Linux. The preview of an archive with many missing links and the audit of large archives no longer stop the app for several seconds. When the plugin is turned off during an import or a resync, it writes no more files and no report.

## 1.0.2

### Patch Changes


## 1.0.1

### Patch Changes

