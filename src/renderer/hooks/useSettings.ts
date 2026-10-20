import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "../../shared/types";

export function useSettings(): [AppSettings | null, (patch: Partial<AppSettings>) => Promise<void>] {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    void window.visualizerApi.getSettings().then(setSettings);
  }, []);

  const update = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    // Apply locally first so sliders stay responsive during the IPC round trip.
    setSettings((previous) => (previous ? { ...previous, ...patch } : previous));
    setSettings(await window.visualizerApi.updateSettings(patch));
  }, []);

  return [settings, update];
}
