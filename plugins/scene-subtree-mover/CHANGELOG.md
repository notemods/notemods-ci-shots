# scene-subtree-mover

## 1.2.1

### Patch Changes

- ba5994a: Add move (Pro), Save named order (Pro) and Preview saved order (Pro) can now be selected without Pro. They show how to get Pro, with a Sponsor on GitHub button. The preview and the saved orders do not change.

## 1.2.0

### Minor Changes

- After a minor or major update, Scene Subtree Mover opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings. Add the Send feedback command. The plugin makes no new network requests.

## 1.1.4

### Patch Changes


## 1.1.3

### Patch Changes


## 1.1.2

### Patch Changes

- 85e6f8b: Treat a GitHub sponsorship reply without an amount as a failed check, not a refusal, and stop the GitHub sign in when the settings close or the plugin unloads.

## 1.1.1

### Patch Changes

- df3258e: Refuse an index with an unquoted whole number above 2^53 in its frontmatter, because the YAML write would silently change that value.

## 1.1.0

### Minor Changes

- 605471f: Add free moves between parent groups with a complete subtree preview and source backup.
