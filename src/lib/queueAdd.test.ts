import { describe, expect, it } from "vitest";
import { appendToQueue } from "./queueAdd";
import type { QueueItem } from "../types";

function track(id: string): QueueItem {
  return {
    id,
    url: `https://youtu.be/${id}`,
    title: id,
    link: { source: "youtube", kind: "video", mediaId: id },
  };
}

describe("appendToQueue", () => {
  it("selects the first track without starting it", () => {
    const patch = appendToQueue({ queue: [], currentIndex: -1 }, track("a"), 1000);
    expect(patch.currentIndex).toBe(0);
    // The point of the whole exercise: no isPlaying in the patch, so a room
    // that was quiet stays quiet until somebody presses play.
    expect(patch).not.toHaveProperty("isPlaying");
  });

  it("cues the first track at its top", () => {
    const patch = appendToQueue({ queue: [], currentIndex: -1 }, track("a"), 1000);
    expect(patch.anchorPosition).toBe(0);
    expect(patch.anchorAt).toBe(1000);
  });

  it("leaves a running queue's playback alone", () => {
    const patch = appendToQueue({ queue: [track("a")], currentIndex: 0 }, track("b"), 1000);
    expect(patch).toEqual({ queue: [track("a"), track("b")] });
  });

  it("appends rather than replacing", () => {
    const patch = appendToQueue({ queue: [track("a")], currentIndex: 0 }, track("b"));
    expect(patch.queue?.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
