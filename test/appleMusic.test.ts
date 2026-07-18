import { describe, expect, it } from "vitest";
import { parseAppleScriptResponse, parseMediaRemoteResponse, parseSwiftMediaRemoteResponse } from "../src/main/appleMusic";

describe("parseAppleScriptResponse", () => {
  it("parses full applescript payload", () => {
    const parsed = parseAppleScriptResponse("abc\u001fSong\u001fArtist\u001fAlbum\u001f123\u001f12.5\u001fplaying");
    expect(parsed).toEqual({
      id: "abc",
      title: "Song",
      artist: "Artist",
      album: "Album",
      sourceName: "Music",
      duration: 123,
      position: 12.5,
      playbackState: "playing"
    });
  });

  it("returns null on malformed payload", () => {
    expect(parseAppleScriptResponse("broken")).toBeNull();
    expect(parseAppleScriptResponse("NOT_RUNNING")).toBeNull();
  });

  it("parses system MediaRemote payloads", () => {
    const parsed = parseMediaRemoteResponse(
      JSON.stringify({
        id: "remote-id",
        title: "Video",
        artist: "",
        album: "",
        sourceName: "Google Chrome",
        duration: 300,
        position: 42,
        playbackRate: 1
      })
    );

    expect(parsed).toEqual({
      id: "remote-id",
      title: "Video",
      artist: "",
      album: "",
      sourceName: "Google Chrome",
      duration: 300,
      position: 42,
      playbackState: "playing"
    });
  });

  it("treats missing MediaRemote playback rate as playing", () => {
    const parsed = parseMediaRemoteResponse(
      JSON.stringify({
        id: "remote-id",
        title: "Song",
        artist: "Artist",
        sourceName: "Yandex Music",
        duration: 180,
        position: 12
      })
    );

    expect(parsed?.playbackState).toBe("playing");
  });

  it("treats explicit zero MediaRemote playback rate as paused", () => {
    const parsed = parseMediaRemoteResponse(
      JSON.stringify({
        id: "remote-id",
        title: "Song",
        artist: "Artist",
        sourceName: "Yandex Music",
        duration: 180,
        position: 12,
        playbackRate: 0,
        hasPlaybackRate: true
      })
    );

    expect(parsed?.playbackState).toBe("paused");
  });

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
        playbackState: "playing"
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
      positionReliable: true
    });
  });
});
