import { WaveformCanvas } from "./WaveformCanvas";
import type { AppSettings } from "../../shared/types";
import type { CSSProperties } from "react";

interface Props {
  settings: AppSettings;
  getSamples: () => number[];
}

export function Visualizer({ settings, getSamples }: Props) {
  const verticalBleed = settings.waveformGlow + settings.lineWidth + 8;
  const height = settings.waveformHeight * 2;
  const style = {
    width: `${settings.waveformWidthPercent}%`,
    height,
    "--visualizer-bleed": `${verticalBleed}px`,
    "--visualizer-bleed-total": `${verticalBleed * 2}px`
  } as CSSProperties;

  return (
    <div className="visualizer" style={style}>
      <WaveformCanvas getSamples={getSamples} settings={settings} />
    </div>
  );
}
