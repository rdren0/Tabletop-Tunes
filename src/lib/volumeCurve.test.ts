import { describe, expect, it } from "vitest";
import {
  MAX_SLIDER,
  sliderToVolume,
  stepVolume,
  VOLUME_LADDER,
  VOLUME_STEP_RUNGS,
  volumeToSlider,
} from "./volumeCurve";

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

describe("stepVolume", () => {
  it("moves up and back down to where it started", () => {
    const up = stepVolume(40, VOLUME_STEP_RUNGS);
    expect(up).toBeGreaterThan(40);
    expect(stepVolume(up, -VOLUME_STEP_RUNGS)).toBe(40);
  });

  it("stops at silence rather than running off the bottom", () => {
    expect(stepVolume(0, -VOLUME_STEP_RUNGS)).toBe(0);
    expect(stepVolume(1, -100)).toBe(0);
  });

  it("stops at full rather than running off the top", () => {
    expect(stepVolume(100, VOLUME_STEP_RUNGS)).toBe(100);
    expect(stepVolume(50, 1000)).toBe(100);
  });

  it("can reach silence from the quietest audible rung", () => {
    // The ladder's second rung is volume 1; one step down from there has to
    // land on the stop, or the buttons could never turn the sound off.
    expect(stepVolume(1, -VOLUME_STEP_RUNGS)).toBe(0);
  });

  it("always lands on a rung the slider can show", () => {
    let v = 0;
    for (let i = 0; i < 40; i += 1) {
      v = stepVolume(v, VOLUME_STEP_RUNGS);
      expect(VOLUME_LADDER).toContain(v);
    }
  });
});
