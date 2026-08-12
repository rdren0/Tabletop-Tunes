import type { ParsedLink } from "./lib/parseLink";

export interface QueueItem {
  id: string; // local uuid, independent of the source media id
  url: string; // original pasted url, shown in the queue for reference
  title: string; // best-effort label; editable by whoever added it
  link: ParsedLink;
}

export interface RoomState {
  queue: QueueItem[];
  currentIndex: number; // -1 if nothing is loaded
  isPlaying: boolean;
  djIds: string[]; // player ids granted DJ privileges by the GM, in addition to the GM
  updatedAt: number;
}

export const EMPTY_ROOM_STATE: RoomState = {
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  djIds: [],
  updatedAt: 0,
};

export const ROOM_METADATA_KEY = "rodeo.tabletoptunes/state";
