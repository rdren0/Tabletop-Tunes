import type { RoomState } from "../types";
import { AdvancerCandidate, hasPanelOpen } from "./advancer";

/**
 * Six missed anchor heartbeats. The client driving the queue republishes its
 * position every 15s while playing, so an anchor older than this means nobody
 * has been driving for a long time.
 */
export const STALE_PLAYBACK_MS = 90_000;

/**
 * Whether the room's `isPlaying` flag is left over from a session that is
 * already over.
 *
 * Room metadata outlives the session that wrote it, and a table that simply
 * shuts Owlbear down never presses pause — so the room reopens weeks later
 * still claiming to be playing, and the first click anywhere in the panel
 * satisfies the browser's gesture requirement and lets a track blare out.
 *
 * Two independent signals have to agree before that flag is overruled, because
 * clearing it wrongly stops the music for a table that is happily listening:
 *
 * - Nobody else is running a panel. The player embed lives in the popover's
 *   iframe, which Owlbear destroys on close, so a room where every panel is
 *   shut is a silent room whatever the flag says.
 * - The anchor is old. On its own this proves less than it looks: only the
 *   client driving the queue republishes it, so a GM who closes their popover
 *   with no DJ to take over leaves the anchor to rot while listeners play on
 *   quite happily.
 */
export function isStalePlayback(
  room: Pick<RoomState, "isPlaying" | "anchorAt">,
  party: AdvancerCandidate[],
  now = Date.now()
): boolean {
  if (!room.isPlaying) return false;
  if (party.some((member) => hasPanelOpen(member, now))) return false;
  // Clocks belong to whoever wrote the anchor, so an anchor from the future is
  // skew rather than staleness — left alone deliberately.
  return now - room.anchorAt > STALE_PLAYBACK_MS;
}
