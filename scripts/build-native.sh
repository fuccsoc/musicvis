#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/runner/work/musicvis/musicvis"
NATIVE_DIR="$ROOT/native/AudioCaptureHelper"
OUTPUT_DIR="$ROOT/resources/native"
OUTPUT_BIN="$OUTPUT_DIR/AudioCaptureHelper"

mkdir -p "$OUTPUT_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Skipping native helper build on non-macOS host"
  exit 0
fi

cd "$NATIVE_DIR"
swift build -c release

BIN_PATH="$NATIVE_DIR/.build/release/AudioCaptureHelper"
cp "$BIN_PATH" "$OUTPUT_BIN"
chmod +x "$OUTPUT_BIN"

echo "Built helper: $OUTPUT_BIN"
