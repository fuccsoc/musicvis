import type { AppSettings, TrackInfo } from "../../shared/types";

interface Props {
  track: TrackInfo | null;
  settings: AppSettings;
}

function TrackIcon({ type }: { type: "song" | "artist" | "album" }) {
  const paths = {
    song: (
      <>
        <path d="M9 18V5l11-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="17" cy="16" r="3" />
      </>
    ),
    artist: (
      <>
        <path d="M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        <path d="M4 22a8 8 0 0 1 16 0" />
      </>
    ),
    album: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v4" />
      </>
    )
  };

  return (
    <svg className="track-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[type]}
    </svg>
  );
}

export function TrackInfoView({ track, settings }: Props) {
  if (!track) {
    return <div className="track-empty">Listening to Mac audio</div>;
  }

  return (
    <div className="track-info" style={{ fontSize: `${settings.textScale}em` }}>
      <h1 className="track-title">
        <TrackIcon type="song" />
        <span>{track.title}</span>
      </h1>
      <p className="track-artist">
        <TrackIcon type="artist" />
        <span>{track.artist || track.sourceName}</span>
      </p>
      {settings.showAlbum && track.album ? (
        <p className="track-album">
          <TrackIcon type="album" />
          <span>{track.album}</span>
        </p>
      ) : null}
    </div>
  );
}
