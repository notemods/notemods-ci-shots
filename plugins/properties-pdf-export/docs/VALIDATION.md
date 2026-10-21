# Validation notes

## Latest run

CI run: https://github.com/theluckystrike/notemods-ci-shots/actions/runs/39546523729

Source commit: fa2a0d18. Build, lint, reproducible build, screenshot capture, media limits and end-to-end tests passed. Unit tests passed 51 of 53 cases. The two failures were Pro integration tests that inspected the DOM before the asynchronous renderer completed. Both tests now await the renderer. This test-only correction has not run in CI because the lane limit of four CI runs has been reached. The lane result is FAILED until a new complete run passes.

## Core PDF evidence

The end-to-end suite passed three tests on each of Obsidian 1.13.4 and 1.14.4. It runs the core Export to PDF command, intercepts its modal and calls the core print-container renderer used by the save pipeline. It applies Chromium print media and checks exactly one visible header outside the frontmatter wrapper. Assertions cover author, a user property named position, boolean values, hidden fields and retained body text. This verifies the print output, rather than a reading-view proxy. It does not write or inspect a saved PDF file.

The lead print-preview image uses that core print container with reading preview off. All five PNGs and all GIF frames were inspected. The table and compact screenshots show the reading header. The folder rules screenshot shows saved settings with Pro inactive; it does not claim an active folder rule.

## Other checks

The static and version gates pass. The strict README scan passes. The README has 1,491 reader words. There are 20 golden vectors. The default hidden names are cssclasses and aliases. Settings describe that all other fields print unless hidden.

The CI addendum prohibits local builds, suites and Obsidian on this host. Local factory check, export-tree and release simulation were not run. The owner must publish the product repository before the README image URLs can resolve publicly.
