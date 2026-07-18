#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE_DIR="$ROOT/native/AudioCaptureHelper"
MEDIA_REMOTE_DIR="$ROOT/native/MediaRemoteHelper"
OUTPUT_DIR="$ROOT/resources/native"
OUTPUT_BIN="$OUTPUT_DIR/AudioCaptureHelper"
MEDIA_REMOTE_BIN="$OUTPUT_DIR/MediaRemoteHelper"
MEDIA_REMOTE_DYLIB="$OUTPUT_DIR/libMediaRemoteAdapter.dylib"

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

cd "$MEDIA_REMOTE_DIR"
swift build -c release

MEDIA_REMOTE_BUILD_BIN="$MEDIA_REMOTE_DIR/.build/release/MediaRemoteHelper"
cp "$MEDIA_REMOTE_BUILD_BIN" "$MEDIA_REMOTE_BIN"
chmod +x "$MEDIA_REMOTE_BIN"

MEDIA_REMOTE_BUILD_DYLIB="$(find "$MEDIA_REMOTE_DIR/.build" -name 'libMediaRemoteAdapter.dylib' -type f | head -n 1)"
if [[ -n "$MEDIA_REMOTE_BUILD_DYLIB" ]]; then
  cp "$MEDIA_REMOTE_BUILD_DYLIB" "$MEDIA_REMOTE_DYLIB"
  chmod +x "$MEDIA_REMOTE_DYLIB"
fi

MEDIA_REMOTE_FRAMEWORK="$(find "$MEDIA_REMOTE_DIR/.build" -path '*/MediaRemoteAdapter.framework' -type d | head -n 1)"
if [[ -n "$MEDIA_REMOTE_FRAMEWORK" ]]; then
  rm -rf "$OUTPUT_DIR/MediaRemoteAdapter.framework"
  cp -R "$MEDIA_REMOTE_FRAMEWORK" "$OUTPUT_DIR/MediaRemoteAdapter.framework"
fi

echo "Built helper: $MEDIA_REMOTE_BIN"
