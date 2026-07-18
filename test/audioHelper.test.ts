import { describe, expect, it } from "vitest";
import { parseHelperJsonLine } from "../src/main/audioHelper";

describe("parseHelperJsonLine", () => {
  it("parses audio line", () => {
    const line = '{"type":"audio","timestamp":1,"samples":[0.1,-0.2,"x"]}';
    expect(parseHelperJsonLine(line)).toEqual({
      type: "audio",
      timestamp: 1,
      samples: [0.1, -0.2]
    });
  });

  it("ignores corrupted line", () => {
    expect(parseHelperJsonLine("not-json")).toBeNull();
  });
});
