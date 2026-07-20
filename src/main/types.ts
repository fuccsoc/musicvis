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

export interface AudioEvent {
  type: "audio";
  timestamp: number;
  samples: number[];
}

export interface StatusEvent {
  type: "status";
  status: "started" | "permission-denied" | "stopped";
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type HelperEvent = AudioEvent | StatusEvent | ErrorEvent;

export interface AppSettings {
  fullscreen: boolean;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  showAlbum: boolean;
  showNothingPlaying: boolean;
  artworkBlur: number;
  artworkBrightness: number;
  overlayOpacity: number;
  waveformWidthPercent: number;
  waveformHeight: number;
  lineWidth: number;
  waveformColorStart: string;
  waveformColorEnd: string;
  waveformFillOpacity: number;
  waveformGlow: number;
  spectrumBucketCount: number;
  bassLevel: number;
  autoScaleStrength: number;
  autoScaleMaxGain: number;
  sensitivity: number;
  smoothing: number;
  idleAmplitude: number;
  textScale: number;
}
