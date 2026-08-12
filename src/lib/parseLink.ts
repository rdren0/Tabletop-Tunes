export type ParsedLink =
  | { source: "youtube"; kind: "video"; mediaId: string; playlistId?: string }
  | { source: "youtube"; kind: "playlist"; mediaId: string }
  | { source: "spotify"; kind: "track"; mediaId: string }
  | { source: "spotify"; kind: "playlist"; mediaId: string }
  | { source: "spotify"; kind: "album"; mediaId: string }
  | { source: "spotify"; kind: "artist"; mediaId: string };

/** Spotify entity types the iframe embed can play. */
const SPOTIFY_KINDS = ["track", "playlist", "album", "artist"] as const;
type SpotifyKind = (typeof SPOTIFY_KINDS)[number];

function isSpotifyKind(value: string | undefined): value is SpotifyKind {
  return !!value && (SPOTIFY_KINDS as readonly string[]).includes(value);
}

/**
 * Accepts a pasted YouTube or Spotify URL (or bare Spotify URI) and returns
 * a normalized description of what to play, or null if it isn't recognized.
 */
export function parseLink(raw: string): ParsedLink | null {
  const input = raw.trim();
  if (!input) return null;

  // Spotify URIs, e.g. spotify:track:4uLU6hMCjMI75M1A2tKUQC
  const uriMatch = input.match(/^spotify:(track|playlist|album|artist):([a-zA-Z0-9]+)/);
  if (uriMatch && isSpotifyKind(uriMatch[1])) {
    return { source: "spotify", kind: uriMatch[1], mediaId: uriMatch[2] };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  // --- YouTube ---
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    if (!id) return null;
    const list = url.searchParams.get("list") ?? undefined;
    return { source: "youtube", kind: "video", mediaId: id, playlistId: list };
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      const list = url.searchParams.get("list") ?? undefined;
      if (id) return { source: "youtube", kind: "video", mediaId: id, playlistId: list };
      // A /watch link with only a list param (e.g. from "play all")
      if (list) return { source: "youtube", kind: "playlist", mediaId: list };
      return null;
    }
    if (url.pathname === "/playlist") {
      const list = url.searchParams.get("list");
      if (list) return { source: "youtube", kind: "playlist", mediaId: list };
      return null;
    }
    if (url.pathname.startsWith("/embed/")) {
      const id = url.pathname.split("/")[2];
      if (id) return { source: "youtube", kind: "video", mediaId: id };
    }
    if (url.pathname.startsWith("/shorts/")) {
      const id = url.pathname.split("/")[2];
      if (id) return { source: "youtube", kind: "video", mediaId: id };
    }
    return null;
  }

  // --- Spotify ---
  if (host === "open.spotify.com") {
    // Locale-prefixed links look like /intl-en/track/ID
    const parts = url.pathname.split("/").filter(Boolean);
    const withoutLocale = parts[0]?.startsWith("intl-") ? parts.slice(1) : parts;
    const [kindPart, idPart] = withoutLocale;
    if (isSpotifyKind(kindPart) && idPart) {
      // Strip any trailing query-string artifacts from copy-pasted share links
      const mediaId = idPart.split("?")[0];
      return { source: "spotify", kind: kindPart, mediaId };
    }
    return null;
  }

  return null;
}

export function isSupportedLink(raw: string): boolean {
  return parseLink(raw) !== null;
}
