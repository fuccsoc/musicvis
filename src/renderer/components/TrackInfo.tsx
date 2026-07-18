import type { TrackInfo } from "../types/track";
import type { AppSettings } from "../types/settings";

interface Props {
  track: TrackInfo | null;
  settings: AppSettings;
}

export function TrackInfoView({ track, settings }: Props) {
  if (!track) {
    return <div className="track-empty">Nothing Playing</div>;
  }

  return (
    <div className="track-info" style={{ fontSize: `${settings.textScale}em` }}>
      <h1 className="track-title">{track.title}</h1>
      <p className="track-artist">{track.artist}</p>
      {settings.showAlbum ? <p className="track-album">{track.album}</p> : null}
    </div>
  );
}
