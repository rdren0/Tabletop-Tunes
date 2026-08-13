/**
 * A loaded YouTube playlist's track ids are only knowable from the live
 * player, which now runs in the background page — but the queue UI that shows
 * them is in the popover. Same origin, so localStorage carries them across,
 * and they stay out of room metadata where a long playlist would blow past
 * Owlbear's size limits.
 */
const KEY = "rodeo.tabletoptunes/playlist";

export function writeFramePlaylist(videoIds: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(videoIds));
  } catch {
    // Storage unavailable; the popover simply won't offer the expansion.
  }
}

export function readFramePlaylist(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function subscribeFramePlaylist(onChange: (videoIds: string[]) => void): () => void {
  function handle(event: StorageEvent) {
    if (event.key !== null && event.key !== KEY) return;
    onChange(readFramePlaylist());
  }
  window.addEventListener("storage", handle);
  return () => window.removeEventListener("storage", handle);
}
