import { describe, expect, it } from "vitest";
import { defaultSettings, parseSettingsJSON } from "../src/main/settings";

describe("parseSettingsJSON", () => {
  it("merges partial settings with defaults", () => {
    const parsed = parseSettingsJSON('{"smoothing":0.4}');
    expect(parsed.smoothing).toBe(0.4);
    expect(parsed.lineWidth).toBe(defaultSettings.lineWidth);
  });

  it("throws on broken JSON", () => {
    expect(() => parseSettingsJSON("{" )).toThrow();
  });
});
