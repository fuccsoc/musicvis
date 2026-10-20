# musicvis

[![CI](https://github.com/fuccsoc/musicvis/actions/workflows/ci.yml/badge.svg)](https://github.com/fuccsoc/musicvis/actions/workflows/ci.yml)

Minimal macOS Now Playing visualizer built with Electron, React, TypeScript, and Swift.

musicvis renders a full-window waveform from system audio, uses macOS Now Playing metadata for track info and artwork, and can show one synced lyric line above the visualizer.

## Features

- System audio waveform powered by ScreenCaptureKit.
- Now Playing metadata, playback position, and artwork via MediaRemote.
- Synced lyrics via LRCLIB, Netease, and no-token Musixmatch fallbacks adapted from Lyrics Plus.
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

Synced lyrics are resolved from LRCLIB, Netease, and Musixmatch. The app uses the first provider that returns synced lines; no Musixmatch API key is required. If none of the providers has synced lyrics for the current track, the lyric row stays empty.

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

## Spotify direct metadata workaround

Spotify metadata, position, and play/pause are read directly through macOS scripting
on every track poll, bypassing stale MediaRemote updates. A playing Spotify takes
priority; a paused Spotify replaces a stale Spotify system session. Another player
selected by MediaRemote still takes over when Spotify is paused. Spotify is never
launched by the poll. Artwork is cached in the background.

Allow musicvis (or Electron during development) to access Spotify when macOS asks.
Access can be managed under System Settings → Privacy & Security → Automation.
If access fails, musicvis falls back to MediaRemote and retries after 30 seconds;
that fallback may still show the original stale system state. Set
`MUSICVIS_SPOTIFY_DIRECT=0` to disable the workaround.

This fixes metadata inside musicvis only. It does not repair Control Center or
BoringNotch, and does not restart mediaremoted. It avoids relying on MediaRemote
notifications; update latency is the existing poll interval plus query time.
