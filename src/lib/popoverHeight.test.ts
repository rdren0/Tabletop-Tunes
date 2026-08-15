import { describe, expect, it } from "vitest";
import { MIN_POPOVER_HEIGHT, maxPopoverHeight, popoverHeightFor } from "./popoverHeight";

describe("maxPopoverHeight", () => {
  it("leaves room for the surrounding chrome", () => {
    expect(maxPopoverHeight(1080)).toBe(920);
  });

  it("falls back when the screen can't be read", () => {
    expect(maxPopoverHeight(undefined)).toBe(900);
    expect(maxPopoverHeight(Number.NaN)).toBe(900);
    expect(maxPopoverHeight(0)).toBe(900);
  });

  it("never returns less than the minimum, even on a tiny screen", () => {
    expect(maxPopoverHeight(200)).toBe(MIN_POPOVER_HEIGHT);
  });
});

describe("popoverHeightFor", () => {
  const MAX = 900;

  it("asks for the panel's own height when nothing is hidden", () => {
    expect(popoverHeightFor({ panelHeight: 520, hiddenQueue: 0 }, MAX)).toBe(520);
  });

  // The panel is capped at the viewport, so once it hits that cap its height
  // stops reporting what the contents want; the hidden queue is the shortfall.
  it("adds back whatever the queue is hiding", () => {
    expect(popoverHeightFor({ panelHeight: 460, hiddenQueue: 140 }, MAX)).toBe(600);
  });

  it("clamps to the maximum rather than growing without bound", () => {
    expect(popoverHeightFor({ panelHeight: 460, hiddenQueue: 5000 }, MAX)).toBe(MAX);
  });

  it("never collapses below the minimum", () => {
    expect(popoverHeightFor({ panelHeight: 10, hiddenQueue: 0 }, MAX)).toBe(MIN_POPOVER_HEIGHT);
  });

  it("rounds fractional layout heights up, so nothing is clipped by a sub-pixel", () => {
    expect(popoverHeightFor({ panelHeight: 519.2, hiddenQueue: 0 }, MAX)).toBe(520);
  });

  it("ignores a negative hidden measurement", () => {
    expect(popoverHeightFor({ panelHeight: 520, hiddenQueue: -30 }, MAX)).toBe(520);
  });

  it("respects the minimum even when the maximum is absurdly small", () => {
    expect(popoverHeightFor({ panelHeight: 800, hiddenQueue: 0 }, 50)).toBe(MIN_POPOVER_HEIGHT);
  });

  /**
   * The loop that matters: asking for more room reveals more queue, which
   * shrinks the hidden amount. It has to settle rather than oscillate.
   */
  it("converges when content fits under the maximum", () => {
    const CONTENT = 700;
    let panelHeight = 460;
    let height = 0;
    for (let i = 0; i < 5; i++) {
      const hiddenQueue = Math.max(0, CONTENT - panelHeight);
      height = popoverHeightFor({ panelHeight, hiddenQueue }, MAX);
      panelHeight = Math.min(height, CONTENT);
    }
    expect(height).toBe(CONTENT);
  });

  it("settles at the maximum when content cannot fit", () => {
    const CONTENT = 4000;
    let panelHeight = 460;
    let height = 0;
    for (let i = 0; i < 5; i++) {
      const hiddenQueue = Math.max(0, CONTENT - panelHeight);
      height = popoverHeightFor({ panelHeight, hiddenQueue }, MAX);
      panelHeight = Math.min(height, CONTENT);
    }
    expect(height).toBe(MAX);
  });
});
