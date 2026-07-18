import { useCallback, useEffect, useMemo, useState } from "react";
import { BackgroundArtwork } from "./components/BackgroundArtwork";
import { SettingsPanel } from "./components/SettingsPanel";
import { TrackInfoView } from "./components/TrackInfo";
import { Visualizer } from "./components/Visualizer";
import { useAudioSamples } from "./hooks/useAudioSamples";
import { useCurrentTrack } from "./hooks/useCurrentTrack";
import { useSettings } from "./hooks/useSettings";

export default function App() {
  const track = useCurrentTrack();
  const { latestSamplesRef, audioStatus } = useAudioSamples();
  const [settings, updateSettings] = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
      if (event.metaKey && event.key === ",") {
        event.preventDefault();
        setSettingsOpen((prev) => !prev);
      }
      if (event.key.toLowerCase() === "f") {
        void window.visualizerApi.toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const getSamples = useCallback(() => latestSamplesRef.current, [latestSamplesRef]);
  const statusLabel = useMemo(() => {
    if (!audioStatus) {
      return "";
    }
    if (audioStatus.type === "error") {
      return audioStatus.message ?? "Audio helper error";
    }
    if (audioStatus.status === "permission-denied") {
      return "Screen Recording permission is required for waveform";
    }
    return "";
  }, [audioStatus]);

  if (!settings) {
    return <div className="app-loading">Loading…</div>;
  }

  return (
    <main className="app" onContextMenu={() => setSettingsOpen((prev) => !prev)}>
      <BackgroundArtwork track={track} settings={settings} />
      <section className="content">
        <Visualizer settings={settings} getSamples={getSamples} />
        {(track || settings.showNothingPlaying) && <TrackInfoView track={track} settings={settings} />}
        {statusLabel ? <p className="status-banner">{statusLabel}</p> : null}
      </section>
      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onUpdate={(patch) => {
          void updateSettings(patch);
        }}
      />
    </main>
  );
}
