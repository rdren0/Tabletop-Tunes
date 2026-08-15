import { describe, expect, it } from "vitest";
import { AdvancerCandidate, PRESENCE_TTL_MS, hasPanelOpen, isAdvancer } from "./advancer";

const NOW = 1_700_000_000_000;

function member(
  id: string,
  role: "GM" | "PLAYER",
  presentAt: number | null = NOW
): AdvancerCandidate {
  return { id, role, presentAt };
}

describe("hasPanelOpen", () => {
  it("is false for a player who has never checked in", () => {
    expect(hasPanelOpen(member("a", "PLAYER", null), NOW)).toBe(false);
  });

  it("is true for a fresh heartbeat", () => {
    expect(hasPanelOpen(member("a", "PLAYER", NOW - 1000), NOW)).toBe(true);
  });

  it("is false once the heartbeat is older than the TTL", () => {
    expect(hasPanelOpen(member("a", "PLAYER", NOW - PRESENCE_TTL_MS - 1), NOW)).toBe(false);
  });

  it("tolerates a single missed beat", () => {
    // The interval is a third of the TTL, so one drop must not unseat anyone.
    expect(hasPanelOpen(member("a", "PLAYER", NOW - PRESENCE_TTL_MS / 2), NOW)).toBe(true);
  });
});

describe("isAdvancer", () => {
  it("elects the GM", () => {
    expect(
      isAdvancer({ isGM: true, isDJ: false, playerId: "gm", djIds: [], party: [], now: NOW })
    ).toBe(true);
  });

  it("stands a DJ down for a GM who is running the panel", () => {
    expect(
      isAdvancer({
        isGM: false,
        isDJ: true,
        playerId: "dj1",
        djIds: ["dj1"],
        party: [member("gm", "GM")],
        now: NOW,
      })
    ).toBe(false);
  });

  // The bug this whole mechanism exists for: a GM sitting in the room with the
  // popover closed cannot advance anything, and used to block every DJ too.
  it("promotes a DJ when the GM is present but has the panel closed", () => {
    expect(
      isAdvancer({
        isGM: false,
        isDJ: true,
        playerId: "dj1",
        djIds: ["dj1"],
        party: [member("gm", "GM", NOW - PRESENCE_TTL_MS - 1)],
        now: NOW,
      })
    ).toBe(true);
  });

  it("promotes a DJ when the GM has never opened the panel", () => {
    expect(
      isAdvancer({
        isGM: false,
        isDJ: true,
        playerId: "dj1",
        djIds: ["dj1"],
        party: [member("gm", "GM", null)],
        now: NOW,
      })
    ).toBe(true);
  });

  it("refuses a listener who holds no DJ grant", () => {
    expect(
      isAdvancer({
        isGM: false,
        isDJ: false,
        playerId: "p1",
        djIds: ["dj1"],
        party: [member("dj1", "PLAYER")],
        now: NOW,
      })
    ).toBe(false);
  });

  describe("with several DJs and no GM running", () => {
    const djIds = ["dj-a", "dj-b", "dj-c"];

    it("elects exactly one — the lowest-sorted id", () => {
      // Run the election from each DJ's own point of view; a client never
      // sees itself in `party`. Exactly one must answer yes, or the queue
      // skips several tracks on a single "ended" event.
      const elected = djIds.filter((id) =>
        isAdvancer({
          isGM: false,
          isDJ: true,
          playerId: id,
          djIds,
          party: djIds.filter((other) => other !== id).map((other) => member(other, "PLAYER")),
          now: NOW,
        })
      );
      expect(elected).toEqual(["dj-a"]);
    });

    it("hands over when the lowest-sorted DJ closes their panel", () => {
      expect(
        isAdvancer({
          isGM: false,
          isDJ: true,
          playerId: "dj-b",
          djIds,
          party: [member("dj-a", "PLAYER", NOW - PRESENCE_TTL_MS - 1), member("dj-c", "PLAYER")],
          now: NOW,
        })
      ).toBe(true);
    });
  });

  it("ignores a running player whose DJ grant was revoked", () => {
    expect(
      isAdvancer({
        isGM: false,
        isDJ: true,
        playerId: "dj-z",
        djIds: ["dj-z"],
        // "dj-a" sorts first but is no longer in djIds, so must not win.
        party: [member("dj-a", "PLAYER")],
        now: NOW,
      })
    ).toBe(true);
  });

  it("refuses when this client has no id yet", () => {
    expect(
      isAdvancer({ isGM: false, isDJ: true, playerId: null, djIds: [], party: [], now: NOW })
    ).toBe(false);
  });
});
