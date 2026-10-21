# table-rollup

## 1.2.0

### Minor Changes

- 9f25af9: After a minor or major update, Table Rollup opens one What's new tab in the background. It links to notemods.com, where you can send feedback. Turn it off in Settings. Add the Send feedback command. The plugin makes no new network requests.

## 1.1.4

### Patch Changes

- 2ebc204: Add storefront links for the free and Pro offers.

## 1.1.3

### Patch Changes

- 880d827: Keep table columns when repeated headers match a written suffix. Read Unicode currency signs. Keep small exponent values in summary rows.

## 1.1.2

### Patch Changes

- 85e6f8b: Treat a GitHub sponsorship reply without an amount as a failed check, not a refusal, and stop the GitHub sign in when the settings close or the plugin unloads.

## 1.1.1

### Patch Changes

- 417a134: A link target with a percent sign or with parentheses no longer stops the draw or cuts the link, script and data URLs in cells show as text, and a summary of a very large column no longer overflows the stack.

## 1.1.0

### Minor Changes

- 706de62: Add a "Find rows" box to the view bar. The box keeps only the rows whose cells or source note name hold the text, and the summary row adds up the rows that are left. The find text is saved with the view in the base file.

## 1.0.4

### Patch Changes

- efdff8f: Correct the GitHub Sponsors payment, check and token storage text in the README.

## 1.0.3

### Patch Changes

- b09257c: After a plugin update or reload with a base open, the view now runs the new plugin code. Before, Bases kept the old view, so Pro and the commands did not reach it until the tab was opened again.

## 1.0.2

### Patch Changes

- facd515: The time stamp in the name of an exported file now comes from the plain JavaScript Date, not from moment. The name format stays the same (YYYY-MM-DD HHmm). This removes the type warnings that the community directory scanner reports for moment calls.

## 1.0.1

### Patch Changes

- 059af6c: Pro stays on when you have paid $15 in total to theluckystrike on GitHub Sponsors. A lifetime buyer who later starts and cancels a monthly sponsorship no longer loses Pro.
