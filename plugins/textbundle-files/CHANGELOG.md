# textbundle-files

## 1.0.3

### Patch Changes

- No visible change for users. The retry for packs that a sync is still writing no longer depends on the error message text. It now uses the error type.

## 1.0.2

### Patch Changes

- Auto import no longer waits 2 seconds or scans again when it refuses a pack. A read error still gets one retry. A refused pack that a sync is still writing gets one more try when its size changes. The error notice shows only if that try fails, or after 60 seconds with no change.

## 1.0.1

### Patch Changes

- Auto import now handles one pack at a time. A sync that adds many large packs keeps only one pack in memory.
