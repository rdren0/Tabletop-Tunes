import { describe, expect, it } from "vitest";
import { StartWatch, initialWatch, observedRoom } from "./roomStart";

/** Replays a run of observations, as the panel would see them. */
function watch(steps: { loaded: boolean; isPlaying: boolean }[]): StartWatch {
  return steps.reduce(observedRoom, initialWatch);
}

describe("observedRoom", () => {
  it("ignores everything before the room's metadata has been read", () => {
    // The empty default reads as paused, which must not count as having seen
    // the room quiet.
    const state = watch([
      { loaded: false, isPlaying: false },
      { loaded: true, isPlaying: true },
    ]);
    expect(state.started).toBe(false);
  });

  it("does not count a room that was already playing on arrival", () => {
    const state = watch([{ loaded: true, isPlaying: true }]);
    expect(state.started).toBe(false);
  });

  it("counts playback starting after the room was seen paused", () => {
    const state = watch([
      { loaded: true, isPlaying: false },
      { loaded: true, isPlaying: true },
    ]);
    expect(state.started).toBe(true);
  });

  it("does not count a track merely being added to an empty queue", () => {
    // Adding no longer starts anything, so the room stays paused and no client
    // has yet been given leave to make noise.
    const state = watch([
      { loaded: true, isPlaying: false },
      { loaded: true, isPlaying: false },
    ]);
    expect(state.started).toBe(false);
  });

  it("lets a late joiner qualify once the room is stopped and started again", () => {
    const state = watch([
      { loaded: true, isPlaying: true },
      { loaded: true, isPlaying: false },
      { loaded: true, isPlaying: true },
    ]);
    expect(state.started).toBe(true);
  });

  it("keeps the permission across a later pause", () => {
    const state = watch([
      { loaded: true, isPlaying: false },
      { loaded: true, isPlaying: true },
      { loaded: true, isPlaying: false },
    ]);
    expect(state.started).toBe(true);
  });

  it("returns the same object when nothing changed, so React can skip a render", () => {
    const first = observedRoom(initialWatch, { loaded: true, isPlaying: false });
    expect(observedRoom(first, { loaded: true, isPlaying: false })).toBe(first);
    const started = observedRoom(first, { loaded: true, isPlaying: true });
    expect(observedRoom(started, { loaded: true, isPlaying: true })).toBe(started);
  });
});
