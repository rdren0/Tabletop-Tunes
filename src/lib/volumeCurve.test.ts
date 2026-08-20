import { describe, expect, it } from "vitest";
import { sliderToVolume, volumeToSlider } from "./volumeCurve";

const positions = Array.from({ length: 101 }, (_, i) => i);

describe("sliderToVolume", () => {
  it("keeps both ends honest", () => {
    expect(sliderToVolume(0)).toBe(0);
    expect(sliderToVolume(100)).toBe(100);
  });

  it("only goes silent at the left stop", () => {
    // The bug this curve exists for: the quiet end used to collapse into 0.
    for (const p of positions.slice(1)) {
      expect(sliderToVolume(p)).toBeGreaterThan(0);
    }
  });

  it("never goes down as the slider goes up", () => {
    let previous = -1;
    for (const p of positions) {
      const volume = sliderToVolume(p);
      expect(volume).toBeGreaterThanOrEqual(previous);
      previous = volume;
    }
  });

  it("spends its first third of travel on the quiet levels", () => {
    expect(sliderToVolume(10)).toBe(1);
    expect(sliderToVolume(20)).toBe(4);
    expect(sliderToVolume(30)).toBe(9);
    // Every one of 1..9 is reachable, which is the whole point.
    const quiet = new Set(positions.slice(0, 31).map(sliderToVolume));
    for (let v = 1; v <= 9; v += 1) expect(quiet.has(v)).toBe(true);
  });

  it("clamps anything out of range", () => {
    expect(sliderToVolume(-20)).toBe(0);
    expect(sliderToVolume(500)).toBe(100);
    expect(sliderToVolume(Number.NaN)).toBe(0);
  });
});

describe("volumeToSlider", () => {
  it("puts the thumb back where that volume came from", () => {
    for (const v of positions) {
      const round = sliderToVolume(volumeToSlider(v));
      // Exact across the quiet end, where the curve has resolution to spare.
      // Past that a single step of the slider is worth more than one step of
      // volume, so not every level has a position of its own — landing within
      // one is the best the mapping can do, and one part in a hundred at that
      // volume is not audible.
      expect(Math.abs(round - v)).toBeLessThanOrEqual(v <= 32 ? 0 : 1);
    }
  });

  it("keeps mute and full at the stops", () => {
    expect(volumeToSlider(0)).toBe(0);
    expect(volumeToSlider(100)).toBe(100);
  });

  it("clamps anything out of range", () => {
    expect(volumeToSlider(-5)).toBe(0);
    expect(volumeToSlider(200)).toBe(100);
    expect(volumeToSlider(Number.NaN)).toBe(0);
  });
});
