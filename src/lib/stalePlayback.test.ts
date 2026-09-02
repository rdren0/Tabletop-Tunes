import { describe, expect, it } from "vitest";
import { STALE_PLAYBACK_MS, isStalePlayback } from "./stalePlayback";
import type { AdvancerCandidate } from "./advancer";

const now = 1_000_000;
const old = { isPlaying: true, anchorAt: now - STALE_PLAYBACK_MS - 1 };

function listener(presentAt: number | null): AdvancerCandidate {
  return { id: "p1", role: "PLAYER", presentAt };
}

describe("isStalePlayback", () => {
  it("leaves a paused room alone", () => {
    expect(isStalePlayback({ isPlaying: false, anchorAt: 0 }, [], now)).toBe(false);
  });

  it("leaves a room alone while its anchor is being republished", () => {
    expect(isStalePlayback({ isPlaying: true, anchorAt: now - 20_000 }, [], now)).toBe(false);
  });

  it("spots playback left over from a session that ended", () => {
    expect(isStalePlayback(old, [], now)).toBe(true);
  });

  it("spots a room that never published an anchor at all", () => {
    expect(isStalePlayback({ isPlaying: true, anchorAt: 0 }, [], now)).toBe(true);
  });

  it("treats an anchor from the future as clock skew, not staleness", () => {
    expect(isStalePlayback({ isPlaying: true, anchorAt: now + 60_000 }, [], now)).toBe(false);
  });

  it("does not stop a listener who is still playing on a rotted anchor", () => {
    // A GM who closed their popover with no DJ behind them leaves nobody
    // republishing the anchor, but the listeners' embeds play on regardless.
    expect(isStalePlayback(old, [listener(now - 5_000)], now)).toBe(false);
  });

  it("ignores party members whose panels are shut", () => {
    expect(isStalePlayback(old, [listener(now - 10 * 60_000), listener(null)], now)).toBe(true);
  });
});
