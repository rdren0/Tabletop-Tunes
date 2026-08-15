import OBR from "@owlbear-rodeo/sdk";

/**
 * Per-listener audio settings that outlive the popover. Owlbear tears down the
 * extension's iframe every time the popover is dismissed, so anything kept
 * only in React state is back to its default on the next open.
 *
 * Two stores, because neither is sufficient alone:
 *
 * - Owlbear's own per-player metadata is authoritative. It travels through the
 *   SDK rather than browser storage, so it works even when the browser blocks
 *   or partitions storage for embedded frames — which is the case localStorage
 *   alone silently failed. It's scoped to the room, and reading it is async.
 * - localStorage seeds the initial value synchronously, so there's no moment
 *   at default volume while the metadata read resolves, and it carries the
 *   setting into rooms this player hasn't opened the panel in before.
 *
 * Writes go to both. Reads prefer the player metadata once it arrives.
 */

const STORAGE_KEY = "rodeo.tabletoptunes/audio";
const METADATA_KEY = "rodeo.tabletoptunes/audio";

export const DEFAULT_VOLUME = 70;

export interface AudioPrefs {
  volume: number;
  muted: boolean;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = { volume: DEFAULT_VOLUME, muted: false };

/** Nothing stored should be able to strand someone at silence. */
function coerce(raw: unknown): AudioPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const { volume, muted } = raw as Partial<AudioPrefs>;
  if (typeof volume !== "number" || !Number.isFinite(volume)) return null;
  return {
    volume: Math.min(100, Math.max(0, volume)),
    muted: muted === true,
  };
}

export function loadLocalPrefs(): AudioPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AUDIO_PREFS;
    return coerce(JSON.parse(raw)) ?? DEFAULT_AUDIO_PREFS;
  } catch {
    // Storage unavailable or holding junk; the defaults are a fine answer.
    return DEFAULT_AUDIO_PREFS;
  }
}

function saveLocalPrefs(prefs: AudioPrefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Blocked storage is exactly why the player metadata copy exists.
  }
}

/** The copy that survives when the browser won't give the iframe storage. */
export async function loadPlayerPrefs(): Promise<AudioPrefs | null> {
  try {
    const metadata = await OBR.player.getMetadata();
    return coerce(metadata[METADATA_KEY]);
  } catch {
    return null;
  }
}

export function savePrefs(prefs: AudioPrefs) {
  saveLocalPrefs(prefs);
  // setMetadata rejects if the extension isn't ready yet; a dropped write here
  // only costs this one change, and localStorage has already taken it.
  OBR.player.setMetadata({ [METADATA_KEY]: prefs }).catch(() => {});
}
