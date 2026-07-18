#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/runner/work/musicvis/musicvis"
SRC="$ROOT/native/AudioCaptureHelper/.build/release/AudioCaptureHelper"
DST="$ROOT/resources/native/AudioCaptureHelper"

mkdir -p "$(dirname "$DST")"
cp "$SRC" "$DST"
chmod +x "$DST"
