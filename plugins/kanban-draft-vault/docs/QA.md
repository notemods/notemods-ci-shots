# Kanban Draft Vault QA

## Dependency

The screenshot procedure needs Kanban 2.0.51 in the lane dev vault.
The end-to-end test installs that version from `mgmeyers/obsidian-kanban` with the launcher.
The screenshot tool disables other community plugins before it starts.
The first QA step enables Kanban again with the public plugin loader.
Each step uses the released new-card form and the public CodeMirror editor to enter sample text.
The Pro steps use a test sponsorship response. They make no live account request.

## Screenshot procedure

1. Install `main.js`, `manifest.json`, and `styles.css` from the Kanban 2.0.51 release into the lane dev vault.
2. Add `obsidian-kanban` to that vault's community plugin list.
3. Acquire the app lock from `AGENTS.md`.
4. Set the lane profile and vault variables.
5. Run `./fx dev kanban-draft-vault` with a timeout.
6. Check the error output and open each image in `docs/`.
7. Run `./fx dev --quit` with the same lane variables.
8. Release the app lock.

The capture shot has a populated board and an open new-card form.
The recovery, fallback, reload, duplicate-lane, and dismissal shots show local saved text.
The history shot shows the latest text and an earlier version.
The search shot shows a Board B result from a local query.
The retention shot shows the three board limits and the Apply button.
The GIF shows capture, cancellation, and text selection.

## Runtime procedure

1. Build the product with its workspace dependencies.
2. Run `pnpm exec tsc -p test/e2e` in the product folder.
3. Acquire the app lock.
4. Run `pnpm run test:e2e` with a timeout.
5. Check both Obsidian version reports.
6. Release the app lock.

The suite reuses one tab. It waits for a rendered board, the new-card editor, local saves, and modal closure.
The service's `openFile` helper makes a new tab. It can leave hidden editors in the DOM.
The suite uses `getLeaf(false)` instead so a hidden earlier form cannot become the test target.
Clipboard denial and a positive Sponsors reply use test doubles inside the test app.
The publisher must check physical mobile devices and live GitHub sign in before a release claim about those cases.
