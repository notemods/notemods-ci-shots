# Local verification

The checks ran on macOS on 14 October 2026. The plugin uses public Obsidian APIs. The tests use local subtitle files and GitHub response fixtures.

## Tests

- 30 acceptance vectors passed.
- 76 unit tests passed in the worktree.
- 76 unit tests passed in the exported repository.
- 14 end-to-end tests passed on Obsidian 1.13.4 with installer 1.5.8.
- 14 end-to-end tests passed on Obsidian 1.14.4 with installer 1.14.4.
- The directory scan found 0 problems.
- The product check printed PASS subtitle-sentence-miner.

## Media review

The dev run reloaded the plugin with 0 errors. The CLI error log had no captured errors. The screenshot plan uses French.srt and Travel.vtt with a study note. Opened the seven PNG files and checked the source text, filter, selected span, question fields, preview, saved template and two source paths. Decoded the GIF and checked the cue list, span editor, preview and cancelled preview frames.

Each PNG is less than 110000 bytes. The GIF is 268981 bytes. A first combined-source shot did not show the second source. The final shot shows selected train cues from both files.

## Export

Two clean builds had the same main.js SHA-256:

```text
0c7acd582326125c0a4dd8030236ef75491296c08dfbba126399e89286cc6a13
```

The exported tests import local source files and the copied vectors. They do not read product.yaml, tools or a monorepo package path.

## Test limits

Linux, Windows, phone and tablet apps were not tested locally. Live sign-in and paid GitHub sponsorships were not tested. Large subtitle files, non-UTF-8 encodings, unusual subtitle dialects and study tool importers were not tested. STYLE and REGION rendering is cut; these blocks are skipped with warnings. No player, media clipping or service download is included.
