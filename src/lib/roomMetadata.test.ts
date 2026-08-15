import { describe, expect, it } from "vitest";
import { EMPTY_ROOM_STATE, QueueItem, ROOM_METADATA_KEY, RoomState } from "../types";
import { hasLegacyState, metadataUpdateFor, readRoomState } from "./roomMetadata";

const PLAYBACK = "rodeo.tabletoptunes/playback";
const QUEUE = "rodeo.tabletoptunes/queue";
const REQUESTS = "rodeo.tabletoptunes/requests";
const ACCESS = "rodeo.tabletoptunes/access";

function track(id: string): QueueItem {
  return {
    id,
    url: `https://youtu.be/${id}`,
    title: id,
    link: { source: "youtube", kind: "video", mediaId: id },
  };
}

function state(overrides: Partial<RoomState> = {}): RoomState {
  return { ...EMPTY_ROOM_STATE, ...overrides };
}

describe("readRoomState", () => {
  it("returns the empty state for a room that has never been used", () => {
    expect(readRoomState({})).toEqual(EMPTY_ROOM_STATE);
  });

  it("reads a room written by the pre-split version", () => {
    const legacy = state({ isPlaying: true, currentIndex: 2, queue: [track("a")] });
    expect(readRoomState({ [ROOM_METADATA_KEY]: legacy })).toEqual(legacy);
  });

  it("reads a room written across group keys", () => {
    const merged = readRoomState({
      [PLAYBACK]: { isPlaying: true, currentIndex: 1, anchorPosition: 5, anchorAt: 99 },
      [QUEUE]: { queue: [track("a"), track("b")] },
      [ACCESS]: { djIds: ["dj1"] },
    });
    expect(merged.isPlaying).toBe(true);
    expect(merged.currentIndex).toBe(1);
    expect(merged.queue).toHaveLength(2);
    expect(merged.djIds).toEqual(["dj1"]);
    // Untouched groups fall back to the empty defaults.
    expect(merged.requests).toEqual([]);
  });

  // A room mid-migration holds both, and must read as the union.
  it("layers group keys over the legacy key", () => {
    const merged = readRoomState({
      [ROOM_METADATA_KEY]: state({ isPlaying: false, queue: [track("old")] }),
      [PLAYBACK]: { isPlaying: true, currentIndex: 0, anchorPosition: 0, anchorAt: 0 },
    });
    expect(merged.isPlaying).toBe(true);
    expect(merged.queue.map((q) => q.id)).toEqual(["old"]);
  });

  it("fills in fields absent from a partial legacy value", () => {
    const merged = readRoomState({ [ROOM_METADATA_KEY]: { isPlaying: true } });
    expect(merged.queue).toEqual([]);
    expect(merged.djIds).toEqual([]);
    expect(merged.currentIndex).toBe(-1);
  });
});

describe("hasLegacyState", () => {
  it("detects the pre-split key", () => {
    expect(hasLegacyState({ [ROOM_METADATA_KEY]: {} })).toBe(true);
    expect(hasLegacyState({ [PLAYBACK]: {} })).toBe(false);
    expect(hasLegacyState({})).toBe(false);
  });
});

describe("metadataUpdateFor", () => {
  it("writes only the group a patch touches", () => {
    const update = metadataUpdateFor(state({ isPlaying: true }), { isPlaying: true });
    expect(Object.keys(update)).toEqual([PLAYBACK]);
  });

  /**
   * The whole point of the split: these two writes touch different keys, so
   * neither can discard the other.
   */
  it("keeps a request write clear of a transport write", () => {
    const requestUpdate = metadataUpdateFor(state(), { requests: [] });
    const transportUpdate = metadataUpdateFor(state(), { isPlaying: true, currentIndex: 3 });
    expect(Object.keys(requestUpdate)).toEqual([REQUESTS]);
    expect(Object.keys(transportUpdate)).toEqual([PLAYBACK]);
    expect(Object.keys(requestUpdate)).not.toContain(PLAYBACK);
  });

  it("writes several groups when a patch spans them", () => {
    const next = state({ queue: [track("a")], currentIndex: 0, isPlaying: true });
    const update = metadataUpdateFor(next, { queue: next.queue, currentIndex: 0, isPlaying: true });
    expect(new Set(Object.keys(update))).toEqual(new Set([QUEUE, PLAYBACK]));
  });

  it("writes a group's whole value, not just the changed field", () => {
    const next = state({ isPlaying: true, currentIndex: 4, anchorPosition: 12, anchorAt: 77 });
    const update = metadataUpdateFor(next, { isPlaying: true });
    // Anchor fields share the playback key; omitting them would erase them.
    expect(update[PLAYBACK]).toEqual({
      currentIndex: 4,
      isPlaying: true,
      anchorPosition: 12,
      anchorAt: 77,
    });
  });

  it("writes nothing for an empty patch", () => {
    expect(metadataUpdateFor(state(), {})).toEqual({});
  });

  describe("migration", () => {
    const next = state({ isPlaying: true, queue: [track("a")], djIds: ["dj1"] });

    it("writes every group so nothing in the legacy key is lost", () => {
      const update = metadataUpdateFor(next, { isPlaying: true }, true);
      expect(new Set(Object.keys(update))).toEqual(
        new Set([PLAYBACK, QUEUE, REQUESTS, ACCESS, "rodeo.tabletoptunes/ambience", ROOM_METADATA_KEY])
      );
    });

    it("clears the legacy key so it can't shadow later writes", () => {
      const update = metadataUpdateFor(next, { isPlaying: true }, true);
      expect(update[ROOM_METADATA_KEY]).toBeUndefined();
      expect(ROOM_METADATA_KEY in update).toBe(true);
    });

    it("round-trips: a migrated room reads back identically", () => {
      const update = metadataUpdateFor(next, {}, true);
      // Re-reading drops the cleared legacy key, as Owlbear would.
      delete update[ROOM_METADATA_KEY];
      expect(readRoomState(update)).toEqual(next);
    });
  });
});
