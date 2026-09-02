import type { QueueItem, RoomState } from "../types";

/**
 * The room patch for appending a track to the queue.
 *
 * Adding to an empty queue *selects* the new track but deliberately does not
 * start it. Music that begins on its own is the problem this exists to stop:
 * whoever runs the room builds the night's list while people are still
 * arriving, and every paste used to put sound in the whole table's ears. A
 * session now opens quiet, and audio waits for a deliberate press of play.
 *
 * Adding to a queue that is already going leaves playback exactly as it is —
 * queueing up the next track must never interrupt the current one.
 */
export function appendToQueue(
  room: Pick<RoomState, "queue" | "currentIndex">,
  item: QueueItem,
  now = Date.now()
): Partial<RoomState> {
  const queue = [...room.queue, item];
  if (room.currentIndex !== -1) return { queue };
  // Cue the track at its top so a later press of play starts from the
  // beginning rather than wherever the last anchor happened to leave things.
  return { queue, currentIndex: 0, anchorPosition: 0, anchorAt: now };
}
