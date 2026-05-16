#!/usr/bin/env bash
set -euo pipefail

OUT="assets/audio"
VOICE="${VOICE:-Samantha}"
RATE="${RATE:-150}"

if ! command -v ffmpeg &>/dev/null; then
  echo "Error: ffmpeg not found. Install it with: brew install ffmpeg" >&2
  exit 1
fi

mkdir -p "$OUT"

speak() {
  local id="$1" text="$2"
  local tmp; tmp="$(mktemp /tmp/cue-XXXXXX.aiff)"
  echo "  $id: \"$text\""
  say -v "$VOICE" -r "$RATE" "$text" -o "$tmp"
  ffmpeg -y -loglevel error -i "$tmp" -codec:a libmp3lame -qscale:a 3 "$OUT/${id}.mp3"
  rm "$tmp"
}

echo "Generating prep cue audio (voice: $VOICE, rate: $RATE)..."

speak prep-4m  "4 minutes."
speak prep-3m  "3 minutes."
speak prep-2m  "2 minutes."
speak prep-1m  "1 minute."
speak prep-30s "30 seconds."
speak prep-5s  "5. [[slnc 180]]4. [[slnc 180]]3. [[slnc 180]]2. [[slnc 180]]1. [[slnc 250]]Time."

echo "Done → $OUT/"
