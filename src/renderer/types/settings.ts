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
  waveformStyle: "wave" | "bars";
  waveformColorStart: string;
  waveformColorEnd: string;
  waveformFillOpacity: number;
  waveformGlow: number;
  barGap: number;
  sensitivity: number;
  smoothing: number;
  idleAmplitude: number;
  textScale: number;
}
