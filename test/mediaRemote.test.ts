import { describe, expect, it } from "vitest";
import { parseSwiftMediaRemoteResponse } from "../src/main/mediaRemote";

describe("parseSwiftMediaRemoteResponse", () => {
  it("parses Swift MediaRemote helper payloads", () => {
    const parsed = parseSwiftMediaRemoteResponse(
      JSON.stringify({
        id: "swift-id",
        title: "Song",
        artist: "Artist",
        album: "Album",
        sourceName: "Yandex Music",
        duration: 147.12,
        position: 44.5,
        playbackState: "playing",
        artworkDataBase64: "aW1hZ2U=",
        artworkMimeType: "image/jpeg"
      })
    );

    expect(parsed).toEqual({
      id: "swift-id",
      title: "Song",
      artist: "Artist",
      album: "Album",
      sourceName: "Yandex Music",
      duration: 147.12,
      position: 44.5,
      playbackState: "playing",
      positionReliable: true,
      artworkDataBase64: "aW1hZ2U=",
      artworkMimeType: "image/jpeg"
    });
  });

  it("returns null on empty or malformed helper payloads", () => {
    expect(parseSwiftMediaRemoteResponse("null")).toBeNull();
    expect(parseSwiftMediaRemoteResponse(JSON.stringify({ artist: "Artist" }))).toBeNull();
  });
});
