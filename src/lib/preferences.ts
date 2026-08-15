import OBR from "@owlbear-rodeo/sdk";

/**
 * Per-listener audio settings that outlive the popover. Owlbear tears down the
 * extension's iframe every time the popover is dismissed, so anything kept
 * only in React state is back to its default on the next open.
 *
 * localStorage is the durable copy and is written synchronously on every
 * change — nothing may be deferred, because a pending timer in an iframe that
 * Owlbear has just destroyed never runs.
 *
 * Owlbear's per-player metadata is a backstop for browsers that deny embedded
 * frames their own storage. It is session state rather than durable storage,
 * so it is only consulted when localStorage gave us nothing at all.
 */

const STORAGE_KEY = "rodeo.tabletoptunes/audio";
const METADATA_KEY = "rodeo.tabletoptunes/audio";

/** Ambient music should sit under the table's conversation, not over it. */
export const DEFAULT_VOLUME = 40;

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

/**
 * Null means this browser is holding nothing for us — either the listener has
 * never touched the controls, or storage is unavailable. Both cases want the
 * default, so the caller can't treat a stored 40 as "no preference".
 */
export function loadLocalPrefs(): AudioPrefs | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return coerce(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Consulted only when localStorage came back empty. */
export async function loadPlayerPrefs(): Promise<AudioPrefs | null> {
  try {
    const metadata = await OBR.player.getMetadata();
    return coerce(metadata[METADATA_KEY]);
  } catch {
    return null;
  }
}

/**
 * Writes the durable copy immediately. Only the Owlbear round trip may be
 * deferred, and the caller owns that debounce.
 */
export function savePrefs(prefs: AudioPrefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Blocked storage is exactly why the player-metadata copy exists.
  }
}

export function savePlayerPrefs(prefs: AudioPrefs) {
  OBR.player.setMetadata({ [METADATA_KEY]: prefs }).catch(() => {
    // A dropped write costs this one change; localStorage already has it.
  });
}
