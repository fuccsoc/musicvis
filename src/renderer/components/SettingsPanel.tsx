import type { AppSettings } from "../../shared/types";

interface Props {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

type KeysOfType<T> = {
  [Key in keyof AppSettings]: AppSettings[Key] extends T ? Key : never;
}[keyof AppSettings];

interface SliderConfig {
  key: KeysOfType<number>;
  label: (value: number) => string;
  min: number;
  max: number;
  step: number;
}

const percent = (name: string) => (value: number) => `${name} ${Math.round(value * 100)}%`;

const sliders: SliderConfig[] = [
  { key: "waveformWidthPercent", label: (v) => `Width ${v}%`, min: 35, max: 100, step: 1 },
  { key: "waveformHeight", label: (v) => `Height ${v}px`, min: 40, max: 320, step: 5 },
  { key: "spectrumBucketCount", label: (v) => `Bands ${v}`, min: 12, max: 384, step: 1 },
  { key: "bassLevel", label: percent("Bass"), min: 0.25, max: 1.2, step: 0.01 },
  { key: "autoScaleStrength", label: percent("Autoscale"), min: 0, max: 1, step: 0.01 },
  { key: "autoScaleMaxGain", label: (v) => `Autoscale cap ${v.toFixed(2)}x`, min: 1, max: 2.2, step: 0.05 },
  { key: "lineWidth", label: (v) => `Line ${v}px`, min: 1, max: 12, step: 1 },
  { key: "waveformFillOpacity", label: percent("Fill"), min: 0, max: 0.8, step: 0.02 },
  { key: "waveformGlow", label: (v) => `Glow ${v}px`, min: 0, max: 44, step: 1 },
  { key: "sensitivity", label: (v) => `Sensitivity ${v.toFixed(1)}`, min: 0.2, max: 4, step: 0.1 },
  { key: "smoothing", label: percent("Smoothing"), min: 0, max: 0.95, step: 0.01 },
  { key: "idleAmplitude", label: (v) => `Idle ${v.toFixed(3)}`, min: 0, max: 0.05, step: 0.001 },
  { key: "artworkBlur", label: (v) => `Blur ${v}px`, min: 0, max: 90, step: 1 },
  { key: "artworkBrightness", label: percent("Backdrop"), min: 0.15, max: 1, step: 0.01 },
  { key: "overlayOpacity", label: percent("Overlay"), min: 0, max: 0.85, step: 0.01 }
];

const toggles: Array<{ key: KeysOfType<boolean>; label: string }> = [
  { key: "showAlbum", label: "Show album" },
  { key: "showNothingPlaying", label: "Show source text" }
];

const colors: Array<{ key: KeysOfType<string>; label: string }> = [
  { key: "waveformColorStart", label: "Color A" },
  { key: "waveformColorEnd", label: "Color B" }
];

const actions: Array<{ label: string; run: () => Promise<void> }> = [
  { label: "Toggle Fullscreen (F)", run: () => window.visualizerApi.toggleFullscreen() },
  { label: "Toggle Always on Top", run: () => window.visualizerApi.toggleAlwaysOnTop() },
  { label: "Toggle Click-through", run: () => window.visualizerApi.toggleClickThrough() },
  { label: "Reload Audio", run: () => window.visualizerApi.restartAudioHelper() },
  { label: "Open Screen Recording Settings", run: () => window.visualizerApi.openSystemPreferences() }
];

export function SettingsPanel({ open, settings, onClose, onUpdate }: Props) {
  if (!open) {
    return null;
  }

  return (
    <aside className="settings-panel" onContextMenu={(event) => event.preventDefault()}>
      <div className="settings-header">
        <h2>Visual</h2>
        <button type="button" onClick={onClose} className="settings-close" aria-label="Close settings">
          ×
        </button>
      </div>

      {toggles.map(({ key, label }) => (
        <label key={key} className="settings-row">
          <span>{label}</span>
          <input type="checkbox" checked={settings[key]} onChange={(event) => onUpdate({ [key]: event.target.checked })} />
        </label>
      ))}

      <div className="settings-colors">
        {colors.map(({ key, label }) => (
          <label key={key}>
            <span>{label}</span>
            <input type="color" value={settings[key]} onChange={(event) => onUpdate({ [key]: event.target.value })} />
          </label>
        ))}
      </div>

      {sliders.map(({ key, label, min, max, step }) => (
        <label key={key}>
          <span>{label(settings[key])}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={settings[key]}
            onChange={(event) => onUpdate({ [key]: Number(event.target.value) })}
          />
        </label>
      ))}

      {actions.map(({ label, run }) => (
        <button key={label} type="button" onClick={() => void run()}>
          {label}
        </button>
      ))}
    </aside>
  );
}
