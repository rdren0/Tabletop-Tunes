import { describe, expect, it } from "vitest";
import { EchoState, initialEcho, observed, pushed, VOLUME_SETTLE_MS } from "./embedVolume";

const SETTLED = VOLUME_SETTLE_MS + 1;

/** Read the embed back repeatedly, as the heartbeat does. */
function ticks(state: EchoState, reads: number[], from: number, every = 2000) {
  const moves: number[] = [];
  let now = from;
  for (const lived of reads) {
    now += every;
    const next = observed(state, lived, now);
    state = next.state;
    if (next.moved) moves.push(lived);
  }
  return { state, moves };
}

describe("observed", () => {
  it("treats what the embed opens at as the baseline", () => {
    const { moves } = ticks(initialEcho, [40, 40, 40], 0);
    expect(moves).toEqual([]);
  });

  it("ignores an embed that rounds our push up, however far", () => {
    // The listener asked for 3 and the embed decided that means 5. Following
    // it would put 5 back under their finger and silently overrule them.
    const { moves } = ticks(pushed(1000), [5, 5, 5], 1000 + SETTLED);
    expect(moves).toEqual([]);
  });

  it("reports somebody working the embed's own control", () => {
    const { moves } = ticks(pushed(1000), [5, 5, 70], 1000 + SETTLED);
    expect(moves).toEqual([70]);
  });

  it("reports a move only once, then holds the new level", () => {
    const { moves } = ticks(pushed(1000), [5, 70, 70, 70], 1000 + SETTLED);
    expect(moves).toEqual([70]);
  });

  it("waits out the settling window rather than reading a stale value", () => {
    // The old volume is still on the wire when the first read lands. Taking it
    // as the echo would make the push itself look like somebody's adjustment.
    let state = pushed(1000);
    const early = observed(state, 40, 1000 + 500);
    expect(early.moved).toBe(false);
    state = early.state;
    const settled = observed(state, 3, 1000 + SETTLED);
    expect(settled.moved).toBe(false);
    expect(settled.state.echoed).toBe(3);
  });

  it("still forgives a step either side of the settled echo", () => {
    const { moves } = ticks(pushed(1000), [40, 41, 39, 40], 1000 + SETTLED);
    expect(moves).toEqual([]);
  });
});
