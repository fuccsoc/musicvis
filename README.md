# musicvis

[![CI](https://github.com/fuccsoc/musicvis/actions/workflows/ci.yml/badge.svg)](https://github.com/fuccsoc/musicvis/actions/workflows/ci.yml)

Minimal macOS Now Playing visualizer built with Electron, React, TypeScript, and Swift.

musicvis renders a full-window waveform from system audio, uses macOS Now Playing metadata for track info and artwork, and can show one synced lyric line above the visualizer.

## Features

- System audio waveform powered by ScreenCaptureKit.
- Now Playing metadata, playback position, and artwork via MediaRemote.
- Synced lyrics via LRCLIB.
- Fullscreen-friendly UI with idle cursor hiding.
- Configurable waveform colors, glow, smoothing, autoscale, and text display.
- Native helper reload button for recovering from macOS audio capture stalls.

## Requirements

- macOS 13 Ventura or newer.
- Node.js 20 or newer.
- npm 10 or newer.
- Xcode Command Line Tools (`xcode-select --install`).
- A player that publishes macOS Now Playing metadata.

## Development

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite renderer, builds the Swift native helpers, and opens Electron.

## Build

```bash
npm run build
npm run build:native
npm run build:mac
```

`build:native` creates:

- `resources/native/AudioCaptureHelper`
- `resources/native/MediaRemoteHelper`
- `resources/native/libMediaRemoteAdapter.dylib`, when produced by the Swift package

The native outputs are generated artifacts and are intentionally ignored by git.

`build:mac` packages unsigned `dmg` and `zip` artifacts through electron-builder. For public distribution you will still need your own signing and notarization setup.

## Versioning and Releases

Version bumps are driven by `npm version`, so `package.json`, `package-lock.json`, the git commit, and the git tag stay in sync:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

Pushing a `vX.Y.Z` tag runs GitHub Actions, builds unsigned macOS artifacts, and publishes a GitHub Release with the generated `dmg`, `zip`, and update metadata.

## macOS Permissions

The waveform requires Screen Recording permission:

System Settings -> Privacy & Security -> Screen Recording

Without this permission, metadata and artwork can still work, but the waveform will not receive system audio samples.

## Lyrics

Synced lyrics are resolved from LRCLIB. If LRCLIB does not have synced lyrics for the current track, the lyric row stays empty.

## Debugging

General metadata/artwork/lyrics/poll logs:

```bash
MUSICVIS_DEBUG=1 npm run dev
```

Verbose audio helper and IPC bridge logs:

```bash
MUSICVIS_DEBUG_AUDIO=1 npm run dev
```

Only the currently displayed lyric line:

```bash
MUSICVIS_DEBUG_LYRICS=1 npm run dev
```

## Settings

Settings are stored at:

```text
~/Library/Application Support/musicvis/settings.json
```

Delete this file to restore defaults.

## GitHub Actions

The CI workflow runs type checks and tests on macOS. Pushes to `main` and manual runs also build unsigned macOS artifacts and upload them from the `release/` directory. Version tags publish a GitHub Release.

## Troubleshooting

- Make sure your player is actively publishing Now Playing metadata.
- Re-grant Screen Recording permission after rebuilding or moving the app.
- Reboot macOS if ScreenCaptureKit keeps returning `application connection being interrupted` after permission or code-signing changes.
- Rebuild native helpers with `npm run build:native` if helper binaries are missing.

## License

WTFPL
