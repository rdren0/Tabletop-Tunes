/**
 * Per-listener settings that outlive the popover. Owlbear tears down the
 * extension's iframe every time the popover is dismissed, so anything kept
 * only in React state is back to its default on the next open.
 *
 * These live in localStorage rather than room metadata on purpose: volume is
 * one person's preference, not part of the shared mix, and it should follow
 * them from room to room instead of being re-learned in each one.
 *
 * Every access is guarded. Storage throws outright in some privacy modes, and
 * a browser that partitions or blocks storage for embedded frames simply gets
 * the defaults back — a forgotten volume is a far better failure than a
 * popover that won't render.
 */

const VOLUME_KEY = "rodeo.tabletoptunes/volume";
const MUTED_KEY = "rodeo.tabletoptunes/muted";

export const DEFAULT_VOLUME = 70;

export function loadVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const value = Number(raw);
    // Never let a corrupt entry strand someone at silence with no obvious cause.
    if (!Number.isFinite(value) || value < 0 || value > 100) return DEFAULT_VOLUME;
    return value;
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function saveVolume(value: number) {
  try {
    window.localStorage.setItem(VOLUME_KEY, String(value));
  } catch {
    // Storage unavailable; the setting just won't survive this session.
  }
}

export function loadMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveMuted(value: boolean) {
  try {
    window.localStorage.setItem(MUTED_KEY, String(value));
  } catch {
    // As above — non-fatal.
  }
}
