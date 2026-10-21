# Validation record

Checked on 2026-10-21 in branch sprint1021/bases-view-tabs.

## CI result

Run: https://github.com/theluckystrike/notemods-ci-shots/actions/runs/39545496575

Source commit: `209c135aac9b46d95bf89abd9609d36f25389359`.
Source tree: `c2427f34a35abe2f0f9c305cc546b6a335ad25d7`.

- `SHOTS PASS bases-view-tabs 4 png 1 gif`.
- `UNIT 70/70 passed, 0 failed`.
- Build, ESLint, Stylelint, unit tests, reproducible build, screenshots, media limits and end-to-end tests passed.
- Two clean builds and the first build have SHA-256 `7db0357ea947c4c7252ca5beacd40ef0b83223dc61cc6b8c676fbdfb38296c09`.
- Four end-to-end spec runs passed on public Obsidian 1.13.4 and 1.14.4.
- The screenshot app loaded and reloaded the plugin with no errors. All six screenshot checks passed on Obsidian 1.14.4.

## File checks

- `node tools/check-product.mjs bases-view-tabs` passed with 10 golden vectors.
- `node tools/version-gate.mjs bases-view-tabs` passed for version 1.0.0.
- `node tools/min-app-version.mjs bases-view-tabs` gave API floor 1.13.0 and first public release 1.13.4. The manifest uses 1.13.4.
- The strict README humanize scan passed.
- The README gate passed with 1353 words, four feature sections and six image references.
- The hosts gate checked the downloaded CI bundle. It found only github.com and api.github.com, with three declared sign-in and sponsorship request sites.

## Visual checks

Each of the four PNGs and all three GIF frames was opened and checked. The free strip shows all three views. The keyboard shot shows Done with focus while All tasks stays selected. The wrap shot uses two rows. The settings shot shows the free toggle and the optional price link. The GIF shows six tasks, then two in-progress tasks, then two done tasks.

Screenshot setup uses explicit awaits. Each view and row assertion completes before capture. The app test also checks that switching leaves the Base text unchanged.

## Fixes

The resume fixed a NodeList iterator build error, three ESLint warnings, four CSS format errors and an unawaited screenshot setup. The fourth CI run passed every stage.

## Local limits

COMMON-CI.md requires Linux CI for builds and app checks. No local build, test suite or Obsidian app was started. The required CI gate replaces the local factory check, export-tree check and release simulation for this lane. The downloaded CI bundle was used for the read-only hosts check.

## Compatibility

Public Bases types expose no view selection method. The plugin uses WorkspaceLeaf.setViewState with the Base viewName state field and attaches at .bases-header. The app tests verify these compatibility points on both tested versions. No core method is patched. Embedded Bases are outside this version's scope.
