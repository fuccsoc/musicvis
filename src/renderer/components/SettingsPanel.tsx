import type { ChangeEvent } from "react";
import type { AppSettings } from "../types/settings";

interface Props {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

type NumberSettingKey = {
  [Key in keyof AppSettings]: AppSettings[Key] extends number ? Key : never;
}[keyof AppSettings];

export function SettingsPanel({ open, settings, onClose, onUpdate }: Props) {
  if (!open) {
    return null;
  }

  const updateNumber = (key: NumberSettingKey) => (event: ChangeEvent<HTMLInputElement>) => {
    onUpdate({ [key]: Number(event.target.value) } as Partial<AppSettings>);
  };

  return (
    <aside className="settings-panel" onContextMenu={(event) => event.preventDefault()}>
      <div className="settings-header">
        <h2>Visual</h2>
        <button type="button" onClick={onClose} className="settings-close" aria-label="Close settings">
          x
        </button>
      </div>

      <div className="settings-row">
        <span>Mode</span>
        <select
          value={settings.waveformStyle}
          onChange={(event) =>
            onUpdate({ waveformStyle: event.target.value as AppSettings["waveformStyle"] })
          }
        >
          <option value="wave">Wave</option>
          <option value="bars">Bars</option>
        </select>
      </div>

      <label className="settings-row">
        <span>Show album</span>
        <input
          type="checkbox"
          checked={settings.showAlbum}
          onChange={(event) => onUpdate({ showAlbum: event.target.checked })}
        />
      </label>

      <label className="settings-row">
        <span>Show source text</span>
        <input
          type="checkbox"
          checked={settings.showNothingPlaying}
          onChange={(event) => onUpdate({ showNothingPlaying: event.target.checked })}
        />
      </label>

      <div className="settings-colors">
        <label>
          <span>Color A</span>
          <input
            type="color"
            value={settings.waveformColorStart}
            onChange={(event) => onUpdate({ waveformColorStart: event.target.value })}
          />
        </label>
        <label>
          <span>Color B</span>
          <input
            type="color"
            value={settings.waveformColorEnd}
            onChange={(event) => onUpdate({ waveformColorEnd: event.target.value })}
          />
        </label>
      </div>

      <label>
        <span>Width {settings.waveformWidthPercent}%</span>
        <input
          type="range"
          min={35}
          max={100}
          step={1}
          value={settings.waveformWidthPercent}
          onChange={updateNumber("waveformWidthPercent")}
        />
      </label>

      <label>
        <span>Height {settings.waveformHeight}px</span>
        <input
          type="range"
          min={40}
          max={320}
          step={5}
          value={settings.waveformHeight}
          onChange={updateNumber("waveformHeight")}
        />
      </label>

      <label>
        <span>Bands {settings.spectrumBucketCount}</span>
        <input
          type="range"
          min={12}
          max={220}
          step={1}
          value={settings.spectrumBucketCount}
          onChange={updateNumber("spectrumBucketCount")}
        />
      </label>

      <label>
        <span>Bass {Math.round(settings.bassLevel * 100)}%</span>
        <input
          type="range"
          min={0.25}
          max={1.2}
          step={0.01}
          value={settings.bassLevel}
          onChange={updateNumber("bassLevel")}
        />
      </label>

      <label>
        <span>Line {settings.lineWidth}px</span>
        <input
          type="range"
          min={1}
          max={12}
          step={1}
          value={settings.lineWidth}
          onChange={updateNumber("lineWidth")}
        />
      </label>

      <label>
        <span>Bar gap {settings.barGap}px</span>
        <input
          type="range"
          min={0}
          max={10}
          step={1}
          value={settings.barGap}
          onChange={updateNumber("barGap")}
        />
      </label>

      <label>
        <span>Fill {Math.round(settings.waveformFillOpacity * 100)}%</span>
        <input
          type="range"
          min={0}
          max={0.8}
          step={0.02}
          value={settings.waveformFillOpacity}
          onChange={updateNumber("waveformFillOpacity")}
        />
      </label>

      <label>
        <span>Glow {settings.waveformGlow}px</span>
        <input
          type="range"
          min={0}
          max={44}
          step={1}
          value={settings.waveformGlow}
          onChange={updateNumber("waveformGlow")}
        />
      </label>

      <label>
        <span>Sensitivity {settings.sensitivity.toFixed(1)}</span>
        <input
          type="range"
          min={0.2}
          max={4}
          step={0.1}
          value={settings.sensitivity}
          onChange={updateNumber("sensitivity")}
        />
      </label>

      <label>
        <span>Smoothing {Math.round(settings.smoothing * 100)}%</span>
        <input
          type="range"
          min={0}
          max={0.95}
          step={0.01}
          value={settings.smoothing}
          onChange={updateNumber("smoothing")}
        />
      </label>

      <label>
        <span>Idle {settings.idleAmplitude.toFixed(3)}</span>
        <input
          type="range"
          min={0}
          max={0.05}
          step={0.001}
          value={settings.idleAmplitude}
          onChange={updateNumber("idleAmplitude")}
        />
      </label>

      <label>
        <span>Blur {settings.artworkBlur}px</span>
        <input
          type="range"
          min={0}
          max={90}
          step={1}
          value={settings.artworkBlur}
          onChange={updateNumber("artworkBlur")}
        />
      </label>

      <label>
        <span>Backdrop {Math.round(settings.artworkBrightness * 100)}%</span>
        <input
          type="range"
          min={0.15}
          max={1}
          step={0.01}
          value={settings.artworkBrightness}
          onChange={updateNumber("artworkBrightness")}
        />
      </label>

      <label>
        <span>Overlay {Math.round(settings.overlayOpacity * 100)}%</span>
        <input
          type="range"
          min={0}
          max={0.85}
          step={0.01}
          value={settings.overlayOpacity}
          onChange={updateNumber("overlayOpacity")}
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
