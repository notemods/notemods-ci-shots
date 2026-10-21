#!/usr/bin/env bash
# ci/media.sh <out-dir>
# raw/<feature>.png -> docs/<feature>.png (max 1200 px wide, <= 400 KB; pngquant if needed)
# frames/<feature>/frames.txt -> docs/<feature>.gif (900 px wide, one shared palette, <= 2 MB)
set -euo pipefail
OUT=$1
MAX_PNG=$((400 * 1024))
MAX_GIF=$((2 * 1024 * 1024))
mkdir -p "$OUT/docs"
size() { stat -c %s "$1"; }
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
bad=0

shopt -s nullglob
for raw in "$OUT"/raw/*.png; do
	name=$(basename "$raw")
	out="$OUT/docs/$name"
	ff -i "$raw" -vf "scale='min(1200,iw)':-2:flags=lanczos" -compression_level 9 "$out"
	if [ "$(size "$out")" -gt "$MAX_PNG" ]; then
		pngquant --quality=70-95 --speed 1 --strip --force --output "$out" "$out" || pngquant --quality=0-80 --speed 1 --strip --force --output "$out" "$out"
	fi
	s=$(size "$out")
	dims=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$out")
	echo "media: docs/$name $dims $((s / 1024)) KB"
	if [ "$s" -gt "$MAX_PNG" ]; then echo "media: FAIL docs/$name is $s bytes (limit $MAX_PNG)"; bad=1; fi
done

for list in "$OUT"/frames/*/frames.txt; do
	feature=$(basename "$(dirname "$list")")
	out="$OUT/docs/$feature.gif"
	for width in 900 800 700; do
		ff -f concat -safe 0 -i "$list" -vf "scale=$width:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 "$out"
		[ "$(size "$out")" -le "$MAX_GIF" ] && break
	done
	s=$(size "$out")
	n=$(grep -c '^file ' "$list")
	echo "media: docs/$feature.gif ${width}px $((n - 1)) frames $((s / 1024)) KB"
	if [ "$s" -gt "$MAX_GIF" ]; then echo "media: FAIL docs/$feature.gif is $s bytes (limit $MAX_GIF)"; bad=1; fi
done
exit $bad
