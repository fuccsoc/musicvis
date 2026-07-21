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

prepare_native_code() {
  local target="$1"

  if [[ "$(uname -s)" != "Darwin" ]] || [[ ! -e "$target" ]]; then
    return 0
  fi

  xattr -dr com.apple.quarantine "$target" 2>/dev/null || true

  if command -v codesign >/dev/null 2>&1; then
    codesign --force --sign - --timestamp=none "$target" >/dev/null
    echo "Prepared native code signature: $target"
  fi
}

mkdir -p "$(dirname "$DST")"
cp "$SRC" "$DST"
chmod +x "$DST"
prepare_native_code "$DST"

cp "$MEDIA_REMOTE_SRC" "$MEDIA_REMOTE_DST"
chmod +x "$MEDIA_REMOTE_DST"
prepare_native_code "$MEDIA_REMOTE_DST"

if [[ -n "$MEDIA_REMOTE_DYLIB_SRC" ]]; then
  cp "$MEDIA_REMOTE_DYLIB_SRC" "$MEDIA_REMOTE_DYLIB_DST"
  chmod +x "$MEDIA_REMOTE_DYLIB_DST"
  prepare_native_code "$MEDIA_REMOTE_DYLIB_DST"
fi

if [[ -n "$MEDIA_REMOTE_FRAMEWORK" ]]; then
  rm -rf "$ROOT/resources/native/MediaRemoteAdapter.framework"
  cp -R "$MEDIA_REMOTE_FRAMEWORK" "$ROOT/resources/native/MediaRemoteAdapter.framework"
  prepare_native_code "$ROOT/resources/native/MediaRemoteAdapter.framework"
fi
