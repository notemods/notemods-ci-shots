# Changelog

## 1.3.2

### Patch Changes

- e007dc4: Without Pro, the notice that the earlier batch can no longer be undone now shows one time in each session.

## 1.3.1

### Patch Changes

- 75a38d4: Save action now shows in the edit dialog without Pro. It shows how to get Pro, with a Sponsor on GitHub button, and saves nothing. A second apply without Pro says that the earlier batch can no longer be undone.

## 1.3.0

### Minor Changes

- 6e98daf: Add Replace list items. It renames one list item in place on the selected notes and keeps the other items. For tags, matching ignores a leading # and letter case. Apply now skips a note when Obsidian has seen a change to its file after the preview, for example from sync, and names the note in the result. A later change to other properties or the body is kept.

## 1.2.0

### Minor Changes

- After a minor or major update, Bases Multi-Row Edit opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings. Add the Send feedback command. The plugin makes no new network requests.

## 1.1.0

### Minor Changes

- ec29b68: Add a Bases table with row selection, property preview, conflict-aware bulk edits and undo. Add optional saved actions and session undo history through GitHub Sponsors.

## 1.0.0

- Add a Bases table view with temporary selection scoped to its query.
- Add typed property set, list append, list item removal and property removal.
- Show per-note previews and skip conflicting edits.
- Add property-level batch undo with conflict retries.
- Add optional saved actions and 20 session undo batches through GitHub Sponsors.
