import type { AppSettings } from "../types/settings";

interface Props {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export function SettingsPanel({ open, settings, onClose, onUpdate }: Props) {
  if (!open) {
    return null;
  }

  return (
    <aside className="settings-panel" onContextMenu={(event) => event.preventDefault()}>
      <button type="button" onClick={onClose} className="settings-close">
        Close
      </button>
      <label>
        Show album
        <input
          type="checkbox"
          checked={settings.showAlbum}
          onChange={(event) => onUpdate({ showAlbum: event.target.checked })}
        />
      </label>
      <label>
        Smoothing
        <input
          type="range"
          min={0}
          max={0.95}
          step={0.01}
          value={settings.smoothing}
          onChange={(event) => onUpdate({ smoothing: Number(event.target.value) })}
        />
      </label>
      <label>
        Sensitivity
        <input
          type="range"
          min={0.2}
          max={3}
          step={0.1}
          value={settings.sensitivity}
          onChange={(event) => onUpdate({ sensitivity: Number(event.target.value) })}
        />
      </label>
      <button type="button" onClick={() => void window.visualizerApi.toggleFullscreen()}>
        Toggle Fullscreen (F)
      </button>
      <button type="button" onClick={() => void window.visualizerApi.toggleAlwaysOnTop()}>
        Toggle Always on Top
      </button>
      <button type="button" onClick={() => void window.visualizerApi.toggleClickThrough()}>
        Toggle Click-through
      </button>
      <button type="button" onClick={() => void window.visualizerApi.openSystemPreferences()}>
        Open Screen Recording Settings
      </button>
    </aside>
  );
}
