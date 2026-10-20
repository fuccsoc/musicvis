import { describe, expect, it } from "vitest";
import { defaultSettings, parseSettingsJSON } from "../src/main/settings";

describe("parseSettingsJSON", () => {
  it("merges partial settings with defaults", () => {
    const parsed = parseSettingsJSON('{"smoothing":0.4}');
    expect(parsed.smoothing).toBe(0.4);
    expect(parsed.lineWidth).toBe(defaultSettings.lineWidth);
  });

  it("drops unknown keys and values of the wrong type", () => {
    const parsed = parseSettingsJSON('{"smoothing":"high","lineWidth":5,"bogus":1,"showAlbum":true}');
    expect(parsed.smoothing).toBe(defaultSettings.smoothing);
    expect(parsed.lineWidth).toBe(5);
    expect(parsed.showAlbum).toBe(true);
    expect(parsed).not.toHaveProperty("bogus");
  });

  it("falls back to defaults for non-object JSON", () => {
    expect(parseSettingsJSON("null")).toEqual(defaultSettings);
    expect(parseSettingsJSON("[1,2]")).toEqual(defaultSettings);
  });

  it("throws on broken JSON", () => {
    expect(() => parseSettingsJSON("{" )).toThrow();
  });
});
