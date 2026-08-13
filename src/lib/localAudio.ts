/**
 * Volume and mute are per-listener and never belong in room metadata, but the
 * popover (where the controls live) and the background page (where playback
 * happens) are separate frames. They share the same origin, so localStorage
 * plus its `storage` event is the bridge between them.
 */
export interface LocalAudio {
  volume: number; // 0-100
  muted: boolean;
}

const KEY = "rodeo.tabletoptunes/audio";

export const DEFAULT_LOCAL_AUDIO: LocalAudio = { volume: 70, muted: false };

export function readLocalAudio(): LocalAudio {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_LOCAL_AUDIO;
    const parsed = JSON.parse(raw) as Partial<LocalAudio>;
    return {
      volume: typeof parsed.volume === "number" ? parsed.volume : DEFAULT_LOCAL_AUDIO.volume,
      muted: typeof parsed.muted === "boolean" ? parsed.muted : DEFAULT_LOCAL_AUDIO.muted,
    };
  } catch {
    // Storage can be unavailable in a partitioned iframe; fall back quietly.
    return DEFAULT_LOCAL_AUDIO;
  }
}

export function writeLocalAudio(audio: LocalAudio): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(audio));
  } catch {
    // Nothing to do — the listener just won't carry settings across frames.
  }
}

/** Calls back whenever another frame on this origin changes the settings. */
export function subscribeLocalAudio(onChange: (audio: LocalAudio) => void): () => void {
  function handle(event: StorageEvent) {
    if (event.key !== null && event.key !== KEY) return;
    onChange(readLocalAudio());
  }
  window.addEventListener("storage", handle);
  return () => window.removeEventListener("storage", handle);
}
