import { ParsedLink } from "./parseLink";

const FALLBACKS: Record<string, string> = {
  "youtube:video": "YouTube video",
  "youtube:playlist": "YouTube playlist",
};

/**
 * Looks up a human-readable title via YouTube's public oEmbed endpoint.
 * Best-effort only: on any failure (network, CORS, timeout) falls back to a
 * generic label rather than blocking the user from adding the item.
 */
export async function fetchTitle(url: string, link: ParsedLink): Promise<string> {
  const fallback = FALLBACKS[`${link.source}:${link.kind}`] ?? "Untitled";
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(oembedUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return fallback;

    const data: { title?: string } = await res.json();
    return data.title?.trim() || fallback;
  } catch {
    return fallback;
  }
}
