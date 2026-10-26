# visual-line-numbers

## 1.2.0

### Minor Changes

- After a minor or major update, Visual Line Numbers opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings. Add the Send feedback command. The plugin makes no new network requests.

## 1.1.3

### Patch Changes

- e0f14e0: Keep the cursor row count on the correct side of a wrapped line boundary. Refresh document numbers after newline edits above the viewport.

## 1.1.2

### Patch Changes

- 85e6f8b: Treat a GitHub sponsorship reply without an amount as a failed check, not a refusal, and stop the GitHub sign in when the settings close or the plugin unloads.

## 1.1.1

### Patch Changes

- 000edfc: Apply the Pro number colors in pop-out windows and correct the README and manifest claims about wrapped rows, long lines and mobile.

## 1.1.0

### Minor Changes

- 7ae3130: Add free dual mode with document line numbers and wrapped row distances in two columns.

## 1.0.2

### Patch Changes

- efdff8f: Correct the GitHub Sponsors payment, check and token storage text in the README.

## 1.0.1

### Patch Changes

- 8a4e3dc: Republish the same code so the directory scans the manifest URLs again. The directory review showed "Manifest URL field is not reachable" for authorUrl and fundingUrl, which return HTTP 200 and are identical to the passing table-rollup manifest. No code change.
