import { describe, expect, it } from "vitest";
import { REQUEST_RESULT_TTL_MS, SongRequest, pruneRequests, requestStatusOf } from "./types";

const NOW = 1_700_000_000_000;

function request(id: string, extra: Partial<SongRequest> = {}): SongRequest {
  return {
    id,
    url: `https://youtu.be/${id}`,
    title: id,
    link: { source: "youtube", kind: "video", mediaId: id },
    requestedById: "p1",
    requestedByName: "Ana",
    ...extra,
  };
}

describe("requestStatusOf", () => {
  it("reads an explicit status", () => {
    expect(requestStatusOf(request("a", { status: "approved" }))).toBe("approved");
    expect(requestStatusOf(request("a", { status: "declined" }))).toBe("declined");
  });

  // Requests written by an earlier version carry no status at all.
  it("treats a missing status as pending", () => {
    expect(requestStatusOf(request("a"))).toBe("pending");
  });
});

describe("pruneRequests", () => {
  it("keeps pending requests regardless of age", () => {
    const requests = [request("a", { status: "pending", resolvedAt: 0 })];
    expect(pruneRequests(requests, NOW)).toHaveLength(1);
  });

  it("keeps a decision that is still fresh, so the requester can read it", () => {
    const requests = [
      request("a", { status: "approved", resolvedAt: NOW - REQUEST_RESULT_TTL_MS / 2 }),
    ];
    expect(pruneRequests(requests, NOW)).toHaveLength(1);
  });

  it("drops a decision older than the TTL", () => {
    const requests = [
      request("a", { status: "declined", resolvedAt: NOW - REQUEST_RESULT_TTL_MS - 1 }),
    ];
    expect(pruneRequests(requests, NOW)).toHaveLength(0);
  });

  it("drops a resolved request with no timestamp rather than keeping it forever", () => {
    expect(pruneRequests([request("a", { status: "approved" })], NOW)).toHaveLength(0);
  });

  it("keeps pending and fresh entries while dropping stale ones", () => {
    const requests = [
      request("pending"),
      request("fresh", { status: "approved", resolvedAt: NOW - 1000 }),
      request("stale", { status: "approved", resolvedAt: NOW - REQUEST_RESULT_TTL_MS - 1 }),
    ];
    expect(pruneRequests(requests, NOW).map((r) => r.id)).toEqual(["pending", "fresh"]);
  });

  it("is idempotent, since several clients may sweep", () => {
    const requests = [
      request("a", { status: "approved", resolvedAt: NOW - REQUEST_RESULT_TTL_MS - 1 }),
      request("b"),
    ];
    const once = pruneRequests(requests, NOW);
    expect(pruneRequests(once, NOW)).toEqual(once);
  });

  it("does not mutate its input", () => {
    const requests = [request("a", { status: "approved", resolvedAt: 0 })];
    pruneRequests(requests, NOW);
    expect(requests).toHaveLength(1);
  });
});
