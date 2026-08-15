/**
 * Who drives the queue forward.
 *
 * Exactly one client may act on a track ending, or every controller skips on
 * the same event and the queue jumps several tracks at once. Kept pure and
 * apart from React so the election can be tested directly — it is difficult to
 * exercise for real, needing several clients in a live room.
 */

export interface AdvancerCandidate {
  id: string;
  role: "GM" | "PLAYER";
  /** Epoch ms this player's panel last checked in, or null if it never has. */
  presentAt: number | null;
}

/** Three missed 15s beats before a client counts as gone. */
export const PRESENCE_TTL_MS = 50_000;

/**
 * Whether a player's panel is open and running right now.
 *
 * Being in the room and running the panel are different things: Owlbear
 * destroys the extension's iframe whenever its popover is closed.
 */
export function hasPanelOpen(member: AdvancerCandidate, now = Date.now()): boolean {
  return member.presentAt !== null && now - member.presentAt < PRESENCE_TTL_MS;
}

export interface ElectionInput {
  /** Whether *this* client is the GM. It is running, by definition. */
  isGM: boolean;
  isDJ: boolean;
  playerId: string | null;
  djIds: string[];
  /** Everyone else in the room; excludes this client. */
  party: AdvancerCandidate[];
  now?: number;
}

/**
 * The GM owns the job. If no GM is *running the panel*, the lowest-sorted DJ
 * who is takes over, so the queue keeps playing rather than stalling.
 *
 * Deferring to a GM who is merely present — rather than one who is running —
 * is what used to stop the queue dead: a GM with the popover closed cannot
 * advance anything, yet every DJ stood down for them.
 */
export function isAdvancer({
  isGM,
  isDJ,
  playerId,
  djIds,
  party,
  now = Date.now(),
}: ElectionInput): boolean {
  if (isGM) return true;
  if (party.some((p) => p.role === "GM" && hasPanelOpen(p, now))) return false;
  if (!playerId || !isDJ) return false;

  const runningDjs = [playerId, ...party.filter((p) => hasPanelOpen(p, now)).map((p) => p.id)]
    .filter((id) => djIds.includes(id))
    .sort();
  return runningDjs[0] === playerId;
}
