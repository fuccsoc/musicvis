import { WaveformCanvas } from "./WaveformCanvas";
import type { AppSettings } from "../types/settings";

interface Props {
  settings: AppSettings;
  getSamples: () => number[];
}

export function Visualizer({ settings, getSamples }: Props) {
  const verticalPadding = settings.waveformGlow + settings.lineWidth + 8;
  const height = settings.waveformHeight * 2 + verticalPadding * 2;

  return (
    <div className="visualizer" style={{ width: `${settings.waveformWidthPercent}%`, height }}>
      <WaveformCanvas getSamples={getSamples} settings={settings} />
    </div>
  );
}
