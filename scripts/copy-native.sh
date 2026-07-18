#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/native/AudioCaptureHelper/.build/release/AudioCaptureHelper"
DST="$ROOT/resources/native/AudioCaptureHelper"
MEDIA_REMOTE_SRC="$ROOT/native/MediaRemoteHelper/.build/release/MediaRemoteHelper"
MEDIA_REMOTE_DST="$ROOT/resources/native/MediaRemoteHelper"
MEDIA_REMOTE_DYLIB_SRC="$(find "$ROOT/native/MediaRemoteHelper/.build" -name 'libMediaRemoteAdapter.dylib' -type f | head -n 1)"
MEDIA_REMOTE_DYLIB_DST="$ROOT/resources/native/libMediaRemoteAdapter.dylib"
MEDIA_REMOTE_FRAMEWORK="$(find "$ROOT/native/MediaRemoteHelper/.build" -path '*/MediaRemoteAdapter.framework' -type d | head -n 1)"

mkdir -p "$(dirname "$DST")"
cp "$SRC" "$DST"
chmod +x "$DST"

cp "$MEDIA_REMOTE_SRC" "$MEDIA_REMOTE_DST"
chmod +x "$MEDIA_REMOTE_DST"

if [[ -n "$MEDIA_REMOTE_DYLIB_SRC" ]]; then
  cp "$MEDIA_REMOTE_DYLIB_SRC" "$MEDIA_REMOTE_DYLIB_DST"
  chmod +x "$MEDIA_REMOTE_DYLIB_DST"
fi

if [[ -n "$MEDIA_REMOTE_FRAMEWORK" ]]; then
  rm -rf "$ROOT/resources/native/MediaRemoteAdapter.framework"
  cp -R "$MEDIA_REMOTE_FRAMEWORK" "$ROOT/resources/native/MediaRemoteAdapter.framework"
fi
