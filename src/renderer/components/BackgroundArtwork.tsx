import type { CSSProperties } from "react";
import type { AppSettings, TrackInfo } from "../../shared/types";

interface Props {
  track: TrackInfo | null;
  settings: AppSettings;
}

export function BackgroundArtwork({ track, settings }: Props) {
  const imagePath = track?.artworkPath
    ? `musicvis-artwork://file?path=${encodeURIComponent(track.artworkPath)}`
    : "";
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
