import { describe, expect, it } from "vitest";
import { parseSourceEventLine, selectTrack, type SourceTrack } from "../src/main/nowPlayingSource";

const spotify: SourceTrack = {
  id: "spotify:track:1",
  title: 'Song "雪"\nTwo',
  artist: "Artist",
  album: "Album",
  sourceName: "Spotify",
  duration: 206,
  position: 25.44,
  positionTimestamp: 1000,
  playbackState: "paused"
};

describe("parseSourceEventLine", () => {
  it("parses MediaRemote track events", () => {
    const event = parseSourceEventLine(
      JSON.stringify({
        type: "mediaRemote",
        track: {
          id: "swift-id",
          title: "Song",
          artist: "Artist",
          album: "Album",
          sourceName: "Yandex Music",
          duration: 147.12,
          position: 44.5,
          positionTimestamp: 1792509386142.3,
          playbackState: "playing",
          artworkDataBase64: "aW1hZ2U=",
          artworkMimeType: "image/jpeg"
        }
      })
    );

    expect(event).toEqual({
      source: "mediaRemote",
      track: {
        id: "swift-id",
        title: "Song",
        artist: "Artist",
        album: "Album",
        sourceName: "Yandex Music",
        duration: 147.12,
        position: 44.5,
        positionTimestamp: 1792509386142.3,
        playbackState: "playing",
        artworkDataBase64: "aW1hZ2U=",
        artworkMimeType: "image/jpeg",
        artworkUrl: undefined
      }
    });
  });

  it("parses Spotify events and preserves Unicode titles", () => {
    const event = parseSourceEventLine(JSON.stringify({ type: "spotify", track: { ...spotify, artworkUrl: null } }));
    expect(event?.source).toBe("spotify");
    expect(event?.track).toMatchObject({ title: spotify.title, position: 25.44, playbackState: "paused", artworkUrl: undefined });
  });

  it("treats a null or untitled track as nothing playing", () => {
    expect(parseSourceEventLine('{"type":"spotify","track":null}')).toEqual({ source: "spotify", track: null });
    expect(parseSourceEventLine('{"type":"mediaRemote","track":{"artist":"Artist"}}')).toEqual({ source: "mediaRemote", track: null });
  });

  it("rejects unknown or malformed lines", () => {
    expect(parseSourceEventLine("not-json")).toBeNull();
    expect(parseSourceEventLine('{"type":"other","track":null}')).toBeNull();
  });
});

describe("selectTrack", () => {
  it("overrides stale system Spotify even when paused", () => {
    expect(selectTrack(spotify, { ...spotify, title: "Old song", playbackState: "playing" })).toBe(spotify);
    expect(selectTrack(spotify, null)).toBe(spotify);
  });

  it("lets another system player take over when Spotify is paused", () => {
    const other = { ...spotify, sourceName: "Music" };
    expect(selectTrack(spotify, other)).toBe(other);
    expect(selectTrack({ ...spotify, playbackState: "playing" }, other)?.sourceName).toBe("Spotify");
    expect(selectTrack(null, other)).toBe(other);
  });
});
