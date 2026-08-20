import { describe, expect, it } from "vitest";
import { MAX_SLIDER, sliderToVolume, VOLUME_LADDER, volumeToSlider } from "./volumeCurve";

const positions = Array.from({ length: MAX_SLIDER + 1 }, (_, i) => i);

describe("sliderToVolume", () => {
  it("keeps both ends honest", () => {
    expect(sliderToVolume(0)).toBe(0);
    expect(sliderToVolume(MAX_SLIDER)).toBe(100);
  });

  it("changes the volume on every single step", () => {
    // The bug this ladder exists for: a dozen positions at the quiet end all
    // meant volume 1, so the thumb moved and nothing else did.
    for (const p of positions.slice(1)) {
      expect(sliderToVolume(p)).toBeGreaterThan(sliderToVolume(p - 1));
    }
  });

  it("only goes silent at the left stop", () => {
    for (const p of positions.slice(1)) {
      expect(sliderToVolume(p)).toBeGreaterThan(0);
    }
  });

  it("gives the quiet levels a rung each, and most of the track", () => {
    // Every level from silence to 32 is its own step, and reaching 32 takes
    // getting on for half the travel — that is the taper doing its job.
    for (let v = 0; v <= 32; v += 1) expect(VOLUME_LADDER[v]).toBe(v);
    expect(volumeToSlider(32) / MAX_SLIDER).toBeGreaterThan(0.4);
    expect(volumeToSlider(32) / MAX_SLIDER).toBeLessThan(0.5);
  });

  it("clamps anything out of range", () => {
    expect(sliderToVolume(-20)).toBe(0);
    expect(sliderToVolume(500)).toBe(100);
    expect(sliderToVolume(Number.NaN)).toBe(0);
  });
});

describe("volumeToSlider", () => {
  it("puts the thumb back where that volume came from", () => {
    for (const p of positions) {
      expect(volumeToSlider(sliderToVolume(p))).toBe(p);
    }
  });

  it("lands on the nearest rung for a volume the slider never set", () => {
    // The embed's own speaker and old stored settings can hand us anything.
    for (let v = 0; v <= 100; v += 1) {
      const landed = sliderToVolume(volumeToSlider(v));
      // Exact across the quiet end, where every level has a rung. Past that a
      // rung is worth more than one step of volume, and one part in a hundred
      // at that level is not audible.
      expect(Math.abs(landed - v)).toBeLessThanOrEqual(v <= 32 ? 0 : 1);
    }
  });

  it("keeps mute and full at the stops", () => {
    expect(volumeToSlider(0)).toBe(0);
    expect(volumeToSlider(100)).toBe(MAX_SLIDER);
  });

  it("clamps anything out of range", () => {
    expect(volumeToSlider(-5)).toBe(0);
    expect(volumeToSlider(200)).toBe(MAX_SLIDER);
    expect(volumeToSlider(Number.NaN)).toBe(0);
  });
});
