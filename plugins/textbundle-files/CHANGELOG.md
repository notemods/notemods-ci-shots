# textbundle-files

## 1.0.2

### Patch Changes

- Auto import no longer waits 2 seconds before it reports a refused pack. A read error still gets one retry.

## 1.0.1

### Patch Changes

- Auto import now handles one pack at a time. A sync that adds many large packs keeps only one pack in memory.
