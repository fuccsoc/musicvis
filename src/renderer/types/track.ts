export type PlaybackState = "playing" | "paused" | "stopped";

export interface TrackInfo {
  id: string;
  title: string;
  artist: string;
  album: string;
  sourceName: string;
  duration: number;
  position: number;
  positionReliable: boolean;
  playbackState: PlaybackState;
  artworkPath: string | null;
  lyricLine: string;
  lyricLines: Array<{ time: number; text: string }>;
  positionUpdatedAt: number;
}
