import { describe, expect, it } from "vitest";
import { isSupportedLink, parseLink } from "./parseLink";

describe("parseLink — videos", () => {
  it("reads a standard watch URL", () => {
    expect(parseLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      source: "youtube",
      kind: "video",
      mediaId: "dQw4w9WgXcQ",
      playlistId: undefined,
    });
  });

  it("reads a short youtu.be URL", () => {
    expect(parseLink("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({
      kind: "video",
      mediaId: "dQw4w9WgXcQ",
    });
  });

  it("reads embed and shorts URLs", () => {
    expect(parseLink("https://www.youtube.com/embed/abc123")).toMatchObject({ mediaId: "abc123" });
    expect(parseLink("https://www.youtube.com/shorts/abc123")).toMatchObject({ mediaId: "abc123" });
  });

  it("accepts the mobile and music hosts", () => {
    expect(parseLink("https://m.youtube.com/watch?v=abc123")).toMatchObject({ mediaId: "abc123" });
    expect(parseLink("https://music.youtube.com/watch?v=abc123")).toMatchObject({
      mediaId: "abc123",
    });
  });

  it("keeps the playlist a video was opened from", () => {
    expect(parseLink("https://www.youtube.com/watch?v=abc123&list=PL999")).toMatchObject({
      kind: "video",
      mediaId: "abc123",
      playlistId: "PL999",
    });
  });

  it("ignores unrelated query parameters", () => {
    expect(parseLink("https://www.youtube.com/watch?v=abc123&t=42s&feature=share")).toMatchObject({
      mediaId: "abc123",
    });
  });
});

describe("parseLink — playlists", () => {
  it("reads a playlist URL", () => {
    expect(parseLink("https://www.youtube.com/playlist?list=PL999")).toEqual({
      source: "youtube",
      kind: "playlist",
      mediaId: "PL999",
    });
  });

  // "Play all" produces a /watch URL carrying only a list.
  it("treats a watch URL with only a list as a playlist", () => {
    expect(parseLink("https://www.youtube.com/watch?list=PL999")).toEqual({
      source: "youtube",
      kind: "playlist",
      mediaId: "PL999",
    });
  });
});

describe("parseLink — rejections", () => {
  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["not a URL", "just some words"],
    ["a bare video id", "dQw4w9WgXcQ"],
    ["another host", "https://vimeo.com/12345"],
    ["a watch URL with no ids", "https://www.youtube.com/watch"],
    ["a playlist URL with no list", "https://www.youtube.com/playlist"],
    ["the YouTube home page", "https://www.youtube.com/"],
    ["a channel", "https://www.youtube.com/@someone"],
    // Spotify support was removed; these must no longer resolve.
    ["a Spotify track", "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"],
    ["a Spotify URI", "spotify:track:4uLU6hMCjMI75M1A2tKUQC"],
  ])("rejects %s", (_label, input) => {
    expect(parseLink(input)).toBeNull();
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseLink("  https://youtu.be/abc123  ")).toMatchObject({ mediaId: "abc123" });
  });
});

describe("isSupportedLink", () => {
  it("agrees with parseLink", () => {
    expect(isSupportedLink("https://youtu.be/abc123")).toBe(true);
    expect(isSupportedLink("https://example.com")).toBe(false);
  });
});
