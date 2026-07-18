# musicvis

Минималистичный macOS-визуализатор для Apple Music на Electron + React + TypeScript + Swift (ScreenCaptureKit).

![Screenshot placeholder](https://via.placeholder.com/1280x720/111111/FFFFFF?text=musicvis+placeholder)

## Требования

- macOS 13 Ventura+
- Node.js 20+
- npm 10+
- Xcode Command Line Tools (`xcode-select --install`)
- Music.app должна быть запущена

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

## Разрешения macOS

Приложение использует:

1. **Automation Permission** (доступ к Music.app)
   - System Settings → Privacy & Security → Automation
2. **Screen Recording Permission** (системное аудио для waveform)
   - System Settings → Privacy & Security → Screen Recording

Без Screen Recording metadata продолжают работать, но waveform будет отключён.

## Apple Music API (опционально)

Fallback-поиск обложки использует:

- `APPLE_MUSIC_DEVELOPER_TOKEN`

Без токена приложение работает с локальной обложкой или тёмным градиентом.

## Lyrics providers (опционально)

Синхронизированные строки lyrics ищутся через:

- `MUSIXMATCH_API_KEY` — официальный Musixmatch API, если ключ задан.
- LRCLIB — fallback без ключа.

Musixmatch на бесплатных/ограниченных планах может не отдавать full synced lyrics.

## Сброс настроек

Настройки: `~/Library/Application Support/<app>/settings.json`

Удалите файл `settings.json`, чтобы восстановить значения по умолчанию.

## Ограничения

- На non-macOS `build-native` пропускается.
- Для waveform требуется системное разрешение Screen Recording.
- Если Music.app не запущена, приложение показывает idle-состояние.

## Troubleshooting

- Проверьте, что Music.app запущена и воспроизводит трек.
- Повторно выдайте Automation/Screen Recording permissions.
- Если helper не стартует, пересоберите: `npm run build:native`.
- Если JSON настроек повреждён, удалите `settings.json`.
