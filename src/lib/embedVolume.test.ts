import { describe, expect, it } from "vitest";
import {
  EchoState,
  initialEcho,
  observed,
  pushed,
  shouldMute,
  VOLUME_SETTLE_MS,
} from "./embedVolume";

const SETTLED = VOLUME_SETTLE_MS + 1;

/** Read the embed back repeatedly, as the heartbeat does. Mute stays put
 *  unless a read says otherwise, so volume cases can ignore it. */
function ticks(
  state: EchoState,
  reads: (number | [number, boolean])[],
  from: number,
  every = 2000
) {
  const moves: number[] = [];
  const muteMoves: boolean[] = [];
  let now = from;
  for (const read of reads) {
    const [lived, livedMuted] = Array.isArray(read) ? read : [read, false];
    now += every;
    const next = observed(state, lived, livedMuted, now);
    state = next.state;
    if (next.moved) moves.push(lived);
    if (next.muteMoved) muteMoves.push(livedMuted);
  }
  return { state, moves, muteMoves };
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
    const early = observed(state, 40, false, 1000 + 500);
    expect(early.moved).toBe(false);
    state = early.state;
    const settled = observed(state, 3, false, 1000 + SETTLED);
    expect(settled.moved).toBe(false);
    expect(settled.state.echoed).toBe(3);
  });

  it("still forgives a step either side of the settled echo", () => {
    const { moves } = ticks(pushed(1000), [40, 41, 39, 40], 1000 + SETTLED);
    expect(moves).toEqual([]);
  });
});

describe("observed, on mute", () => {
  it("does not read our own mute back as somebody flipping it", () => {
    // The regression this exists for. We push mute; isMuted() answers with the
    // stale value for a moment; taking that as a change reported "not muted"
    // and the panel unmuted itself a tick later. Mute never stuck, and neither
    // did a slider dragged to zero, which is carried as mute.
    const { muteMoves } = ticks(pushed(1000), [[50, false], [50, true], [50, true]], 1000);
    expect(muteMoves).toEqual([]);
  });

  it("reports somebody using the embed's own mute button", () => {
    const { muteMoves } = ticks(
      pushed(1000),
      [[50, false], [50, false], [50, true]],
      1000 + SETTLED
    );
    expect(muteMoves).toEqual([true]);
  });

  it("reports a mute change only once, then holds it", () => {
    const { muteMoves } = ticks(
      pushed(1000),
      [[50, false], [50, true], [50, true], [50, true]],
      1000 + SETTLED
    );
    expect(muteMoves).toEqual([true]);
  });

  it("follows an unmute made on the embed too", () => {
    const { muteMoves } = ticks(
      pushed(1000),
      [[50, true], [50, false]],
      1000 + SETTLED
    );
    expect(muteMoves).toEqual([false]);
  });

  it("keeps volume and mute apart", () => {
    // A volume nudged on the embed must not carry a mute verdict with it.
    const { moves, muteMoves } = ticks(
      pushed(1000),
      [[50, true], [70, true]],
      1000 + SETTLED
    );
    expect(moves).toEqual([70]);
    expect(muteMoves).toEqual([]);
  });
});

describe("shouldMute", () => {
  it("mutes when the listener asked for mute", () => {
    expect(shouldMute(60, true)).toBe(true);
  });

  it("mutes at the bottom of the slider, which the embed cannot hold as a volume", () => {
    expect(shouldMute(0, false)).toBe(true);
  });

  it("leaves an audible volume alone", () => {
    expect(shouldMute(1, false)).toBe(false);
    expect(shouldMute(100, false)).toBe(false);
  });

  it("treats a nonsense volume as silence rather than as full blast", () => {
    expect(shouldMute(NaN, false)).toBe(true);
    expect(shouldMute(-5, false)).toBe(true);
  });
});
