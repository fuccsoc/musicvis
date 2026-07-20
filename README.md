# musicvis

Минималистичный macOS-визуализатор для системного Now Playing на Electron + React + TypeScript + Swift (ScreenCaptureKit).

![Screenshot placeholder](https://via.placeholder.com/1280x720/111111/FFFFFF?text=musicvis+placeholder)

## Требования

- macOS 13 Ventura+
- Node.js 20+
- npm 10+
- Xcode Command Line Tools (`xcode-select --install`)
- Любой плеер, который публикует Now Playing metadata в macOS MediaRemote

## Установка

```bash
npm install
```

## Development

```bash
npm run dev
```

Запускаются:
- Vite dev server
- Electron app
- build-native (на macOS)

## Сборка

```bash
npm run build
npm run build:native
npm run build:mac
```

`electron-builder` включает `resources/native/AudioCaptureHelper` через `extraResources`.

`build:native` также собирает `MediaRemoteHelper` на базе Swift package
`ejbills/mediaremote-adapter`. Он является единственным источником metadata,
position и artwork; lyrics ищутся отдельно по artist/title/album.

## Разрешения macOS

Приложение использует:

1. **Screen Recording Permission** (системное аудио для waveform)
   - System Settings → Privacy & Security → Screen Recording

Без Screen Recording metadata продолжают работать, но waveform будет отключён.

## Lyrics providers (опционально)

Синхронизированные строки lyrics ищутся через:

- `MUSIXMATCH_API_KEY` — официальный Musixmatch API, если ключ задан.
- LRCLIB — fallback без ключа.

Musixmatch на бесплатных/ограниченных планах может не отдавать full synced lyrics.

Для полной диагностики metadata/artwork/lyrics/poll:

```bash
MUSICVIS_DEBUG=1 npm run dev
```

Для компактного лога только текущих строк lyrics:

```bash
MUSICVIS_DEBUG_LYRICS=1 npm run dev
```

## Сброс настроек

Настройки: `~/Library/Application Support/<app>/settings.json`

Удалите файл `settings.json`, чтобы восстановить значения по умолчанию.

## Ограничения

- На non-macOS `build-native` пропускается.
- Для waveform требуется системное разрешение Screen Recording.
- Если ни один плеер не публикует Now Playing metadata, приложение показывает idle-состояние.

## Troubleshooting

- Проверьте, что плеер воспроизводит трек и виден в системном Now Playing.
- Повторно выдайте Screen Recording permission.
- Если helper не стартует, пересоберите: `npm run build:native`.
- Если JSON настроек повреждён, удалите `settings.json`.
