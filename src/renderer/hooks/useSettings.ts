import { useEffect, useState } from "react";
import type { AppSettings } from "../types/settings";

export function useSettings(): [AppSettings | null, (patch: Partial<AppSettings>) => Promise<void>] {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    void window.visualizerApi.getSettings().then(setSettings);
  }, []);

  const update = async (patch: Partial<AppSettings>): Promise<void> => {
    const next = await window.visualizerApi.updateSettings(patch);
    setSettings(next);
  };

  return [settings, update];
}
