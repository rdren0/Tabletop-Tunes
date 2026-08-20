/**
 * The slider's travel is not the player's volume.
 *
 * Two problems with mapping them straight through. Loudness is perceived
 * closer to logarithmically than linearly, so on a 0-100 linear track
 * everything past about 30 sounds much the same while the quiet levels people
 * actually want under a session are squeezed into the far left. And the track
 * lives in a 380px popover: at that width a single pixel covers more than one
 * step, so the bottom of the range simply cannot be landed on — dragging left
 * jumps from "still too loud" to silence.
 *
 * A squared curve spends its first third of travel on volumes 1-10 and the
 * rest on the range where a change is still audible, which fixes both.
 */
const CURVE = 2;

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Slider position (0-100) to player volume (0-100). */
export function sliderToVolume(position: number): number {
  const p = clamp(position);
  if (p <= 0) return 0;
  // Anything off the left stop is an intent to hear something, so the curve
  // never rounds its way back to silence. Only the stop itself is off.
  return Math.max(1, Math.round(Math.pow(p / 100, CURVE) * 100));
}

/** Player volume (0-100) to the slider position that produces it. */
export function volumeToSlider(volume: number): number {
  const v = clamp(volume);
  if (v <= 0) return 0;
  return Math.max(1, Math.round(Math.pow(v / 100, 1 / CURVE) * 100));
}
