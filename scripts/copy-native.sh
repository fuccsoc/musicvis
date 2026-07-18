#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/native/AudioCaptureHelper/.build/release/AudioCaptureHelper"
DST="$ROOT/resources/native/AudioCaptureHelper"

mkdir -p "$(dirname "$DST")"
cp "$SRC" "$DST"
chmod +x "$DST"
