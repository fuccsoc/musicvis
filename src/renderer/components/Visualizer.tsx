import { WaveformCanvas } from "./WaveformCanvas";
import type { AppSettings } from "../types/settings";

interface Props {
  settings: AppSettings;
  getSamples: () => number[];
}

export function Visualizer({ settings, getSamples }: Props) {
  return (
    <div className="visualizer" style={{ width: `${settings.waveformWidthPercent}%` }}>
      <WaveformCanvas getSamples={getSamples} settings={settings} />
    </div>
  );
}
