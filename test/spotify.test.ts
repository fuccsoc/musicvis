import { describe, expect, it } from "vitest";
import { parseSpotifyResponse, selectTrack } from "../src/main/spotify";

const payload = { id: "spotify:track:1", title: 'Song "雪"\nTwo', artist: "Artist", album: "Album", duration: 206000, position: 25.44, playbackState: "paused" };
const spotify = parseSpotifyResponse(JSON.stringify(payload))!;

describe("Spotify direct metadata", () => {
  it("preserves Unicode, pause and seek position and converts duration to seconds", () => {
    expect(spotify).toMatchObject({ title: payload.title, duration: 206, position: 25.44, playbackState: "paused", positionReliable: true });
    expect(parseSpotifyResponse("null")).toBeNull();
    expect(parseSpotifyResponse('{"title":"Missing state"}')).toBeNull();
  });
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
