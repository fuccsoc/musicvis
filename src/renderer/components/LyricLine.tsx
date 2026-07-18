import type { TrackInfo } from "../types/track";

interface Props {
  track: TrackInfo | null;
}

export function LyricLine({ track }: Props) {
  const line = track?.lyricLine ?? "";
  return (
    <p className="lyric-line">
      <span key={line || "empty"} className="lyric-line-text">
        {line}
      </span>
    </p>
  );
}
