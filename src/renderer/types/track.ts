export type PlaybackState = "playing" | "paused" | "stopped";

export interface TrackInfo {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  playbackState: PlaybackState;
  artworkPath: string | null;
}
