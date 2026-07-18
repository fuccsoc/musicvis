import type { CSSProperties } from "react";
import type { TrackInfo } from "../types/track";
import type { AppSettings } from "../types/settings";

interface Props {
  track: TrackInfo | null;
  settings: AppSettings;
}

export function BackgroundArtwork({ track, settings }: Props) {
  const imagePath = track?.artworkPath ? `file://${track.artworkPath}` : "";
  const style = {
    "--waveform-color-start": settings.waveformColorStart,
    "--waveform-color-end": settings.waveformColorEnd
  } as CSSProperties;

  return (
    <div className="background-root" style={style}>
      {imagePath ? (
        <div
          className="background-image"
          style={{
            backgroundImage: `url('${imagePath}')`,
            filter: `blur(${settings.artworkBlur}px) brightness(${settings.artworkBrightness})`
          }}
        />
      ) : (
        <div className="background-fallback" />
      )}
      <div className="background-overlay" style={{ opacity: settings.overlayOpacity }} />
    </div>
  );
}
