import type { ParsedLink } from "./lib/parseLink";

export interface QueueItem {
  id: string; // local uuid, independent of the source media id
  url: string; // original pasted url, shown in the queue for reference
  title: string; // best-effort label; editable by whoever added it
  link: ParsedLink;
}

/** A track a listener has proposed; a GM or DJ decides whether it joins the queue. */
export interface SongRequest extends QueueItem {
  requestedById: string;
  requestedByName: string;
}

export interface RoomState {
  queue: QueueItem[];
  currentIndex: number; // -1 if nothing is loaded
  isPlaying: boolean;
  djIds: string[]; // player ids granted DJ privileges by the GM, in addition to the GM
  requests: SongRequest[]; // pending listener suggestions
  /**
   * Where playback was at `anchorAt`, in seconds into the current track.
   * Clients extrapolate from this pair to stay roughly in step: while playing,
   * the expected position is `anchorPosition + (now - anchorAt)`.
   */
  anchorPosition: number;
  anchorAt: number; // epoch ms, from the writing client's clock
  updatedAt: number;
}

export const EMPTY_ROOM_STATE: RoomState = {
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  djIds: [],
  requests: [],
  anchorPosition: 0,
  anchorAt: 0,
  updatedAt: 0,
};

export const ROOM_METADATA_KEY = "rodeo.tabletoptunes/state";

/** Seconds of drift tolerated before a client seeks to catch up. */
export const SYNC_TOLERANCE_SECONDS = 2;
