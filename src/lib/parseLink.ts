export type ParsedLink =
  | { source: "youtube"; kind: "video"; mediaId: string; playlistId?: string }
  | { source: "youtube"; kind: "playlist"; mediaId: string };

/**
 * Accepts a pasted YouTube URL and returns a normalized description of what to
 * play, or null if it isn't recognized.
 */
export function parseLink(raw: string): ParsedLink | null {
  const input = raw.trim();
  if (!input) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

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

  return null;
}

export function isSupportedLink(raw: string): boolean {
  return parseLink(raw) !== null;
}
