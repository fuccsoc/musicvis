import type { TrackInfo } from "../types/track";

interface Props {
  track: TrackInfo | null;
}

export function LyricLine({ track }: Props) {
  return <p className="lyric-line">{track?.lyricLine ?? ""}</p>;
}
