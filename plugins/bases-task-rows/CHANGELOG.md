# bases-task-rows

## 1.4.0

### Minor Changes

- Add a Task progress view to Bases that shows one row for each note with its open, done and total tasks, a progress bar, the next due date and the overdue count.

## 1.3.0

### Minor Changes

- After a minor or major update, Bases Task Rows opens one What's new tab in the background. It links to notemods.com, where you can send feedback. Turn it off in Settings. Add the Send feedback command. The plugin makes no new network requests.

## 1.2.0

### Minor Changes

- 880d827: Read ISO date links in Tasks and Dataview fields. Reject invalid calendar dates. Keep metadata inside code spans as text.

## 1.1.2

### Patch Changes

- 85e6f8b: Treat a GitHub sponsorship reply without an amount as a failed check, not a refusal, and stop the GitHub sign in when the settings close or the plugin unloads.

## 1.1.1

### Patch Changes

- b003a8d: Complete selected no longer changes cancelled or done tasks or adds a second next occurrence, a selection clears when lines above it move, and the view reads a note again when the metadata cache catches up after a write.

## 1.1.0

### Minor Changes

- c1af3f3: Tick a recurring task to write the next occurrence on the line below (Pro)

## 1.0.3

### Patch Changes

- efdff8f: Correct the GitHub Sponsors payment, check and token storage text in the README.

## 1.0.2

### Patch Changes

- b09257c: After a plugin update or reload with a base open, the view now runs the new plugin code. Before, Bases kept the old view, so a Pro change did not redraw it until the tab was opened again.

## 1.0.1

### Patch Changes

- facd515: The date for today now comes from the plain JavaScript Date, not from moment. This removes the 3 type warnings that the community directory scanner reported at src/view.ts line 51. The view works as before.
