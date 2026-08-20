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
 * A squared curve fixes both, but curving a 0-100 track onto a 0-100 volume
 * cannot be the whole answer: the compression has to go somewhere, and it went
 * into dead travel. A dozen positions at the quiet end all meant volume 1, so
 * the thumb kept moving, and moving, while the level and the readout sat
 * still — a control that answers a click by doing nothing reads as broken
 * however good the taper behind it is.
 *
 * So the curve is used to pick the rungs rather than to scale the travel. Every
 * distinct volume it can produce becomes one step of the slider, and nothing
 * else does: 76 rungs, each a real change, with the first 44% of the track
 * spent on volumes 0-32 where a change is worth hearing.
 */
const CURVE = 2;

/**
 * Every volume the curve can reach, ascending, one per slider step. Derived
 * rather than written out, so the shape of the taper lives in one number.
 */
export const VOLUME_LADDER: number[] = (() => {
  const rungs = new Set<number>([0]);
  for (let p = 1; p <= 100; p += 1) {
    // Anything off the left stop is an intent to hear something, so the curve
    // never rounds its way back to silence. Only the stop itself is off.
    rungs.add(Math.max(1, Math.round(Math.pow(p / 100, CURVE) * 100)));
  }
  return [...rungs].sort((a, b) => a - b);
})();

/** The slider's last position. Its first is 0, which is silence. */
export const MAX_SLIDER = VOLUME_LADDER.length - 1;

/** Slider position (0-MAX_SLIDER) to player volume (0-100). */
export function sliderToVolume(position: number): number {
  if (!Number.isFinite(position)) return 0;
  const index = Math.min(MAX_SLIDER, Math.max(0, Math.round(position)));
  return VOLUME_LADDER[index];
}

/**
 * Player volume (0-100) to the slider position that produces it — the nearest
 * rung, since a volume set from outside the slider (the embed's own speaker, a
 * stored preference) need not be one of ours.
 */
export function volumeToSlider(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  const v = Math.min(100, Math.max(0, volume));
  let nearest = 0;
  for (let i = 1; i <= MAX_SLIDER; i += 1) {
    if (Math.abs(VOLUME_LADDER[i] - v) < Math.abs(VOLUME_LADDER[nearest] - v)) nearest = i;
  }
  return nearest;
}
