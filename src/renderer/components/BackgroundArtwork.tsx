import type { TrackInfo } from "../types/track";
import type { AppSettings } from "../types/settings";

interface Props {
  track: TrackInfo | null;
  settings: AppSettings;
}

export function BackgroundArtwork({ track, settings }: Props) {
  const imagePath = track?.artworkPath ? `file://${track.artworkPath}` : "";

  return (
    <div className="background-root">
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
