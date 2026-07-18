import { WaveformCanvas } from "./WaveformCanvas";
import type { TrackInfo } from "../types/track";
import type { AppSettings } from "../types/settings";

interface Props {
  track: TrackInfo | null;
  settings: AppSettings;
  getSamples: () => number[];
}

export function Visualizer({ track, settings, getSamples }: Props) {
  return (
    <div className="visualizer" style={{ width: `${settings.waveformWidthPercent}%` }}>
      <WaveformCanvas
        getSamples={getSamples}
        playing={track?.playbackState === "playing"}
        settings={settings}
      />
    </div>
  );
}
