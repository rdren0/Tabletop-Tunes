import type { ParsedLink } from "./lib/parseLink";

export interface QueueItem {
  id: string; // local uuid, independent of the source media id
  url: string; // original pasted url, shown in the queue for reference
  title: string; // best-effort label; editable by whoever added it
  link: ParsedLink;
}

export type RequestStatus = "pending" | "approved" | "declined";

/** A track a listener has proposed; a GM or DJ decides whether it joins the queue. */
export interface SongRequest extends QueueItem {
  requestedById: string;
  requestedByName: string;
  /**
   * A decided request sticks around briefly rather than vanishing, so the
   * person who asked learns which way it went. Absent on requests written by
   * an older version of the extension, which were always pending.
   */
  status?: RequestStatus;
  resolvedAt?: number; // epoch ms the decision was made
}

/** How long a decided request lingers so the requester can see the outcome. */
export const REQUEST_RESULT_TTL_MS = 60_000;

export function requestStatusOf(request: SongRequest): RequestStatus {
  return request.status ?? "pending";
}

/**
 * Drops decisions old enough to have been seen. Room metadata is a small,
 * shared budget, so resolved requests must not accumulate in it.
 */
export function pruneRequests(requests: SongRequest[], now = Date.now()): SongRequest[] {
  return requests.filter(
    (r) => requestStatusOf(r) === "pending" || now - (r.resolvedAt ?? 0) < REQUEST_RESULT_TTL_MS
  );
}

/**
 * A looping background sound that plays *alongside* the queue — rain, a tavern,
 * combat drums. Several can run at once, and unlike listener volume, each
 * stream's level is part of the shared mix the GM builds.
 */
export interface AmbienceStream {
  id: string;
  url: string;
  title: string;
  videoId: string;
  volume: number; // 0-100, relative level within the mix
  playing: boolean;
}

export interface RoomState {
  queue: QueueItem[];
  currentIndex: number; // -1 if nothing is loaded
  isPlaying: boolean;
  djIds: string[]; // player ids granted DJ privileges by the GM, in addition to the GM
  requests: SongRequest[]; // pending listener suggestions
  ambience: AmbienceStream[]; // looping beds that play under the queue
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
  ambience: [],
  anchorPosition: 0,
  anchorAt: 0,
  updatedAt: 0,
};

export const ROOM_METADATA_KEY = "rodeo.tabletoptunes/state";

/** Seconds of drift tolerated before a client seeks to catch up. */
export const SYNC_TOLERANCE_SECONDS = 2;
