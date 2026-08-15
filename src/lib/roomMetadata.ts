import { EMPTY_ROOM_STATE, ROOM_METADATA_KEY, RoomState } from "../types";

/**
 * Room metadata is last-write-wins *per key*, and a write replaces that key's
 * whole value. Holding all shared state under one key therefore made every
 * write a whole-room write: a listener filing a song request and a GM skipping
 * a track in the same instant meant one silently discarded the other's change.
 *
 * Splitting state across keys by concern confines that collision to people
 * editing the same thing. Two clients both reordering the queue still race —
 * that is inherent — but a request can no longer undo a track change.
 */
export const METADATA_GROUPS = {
  "rodeo.tabletoptunes/playback": ["currentIndex", "isPlaying", "anchorPosition", "anchorAt"],
  "rodeo.tabletoptunes/queue": ["queue"],
  "rodeo.tabletoptunes/requests": ["requests"],
  "rodeo.tabletoptunes/access": ["djIds"],
  "rodeo.tabletoptunes/ambience": ["ambience"],
} as const satisfies Record<string, readonly (keyof RoomState)[]>;

type GroupKey = keyof typeof METADATA_GROUPS;

const GROUP_KEYS = Object.keys(METADATA_GROUPS) as GroupKey[];

/** Which group owns each field, so a patch can be routed without a scan. */
const OWNER = new Map<keyof RoomState, GroupKey>(
  GROUP_KEYS.flatMap((key) => METADATA_GROUPS[key].map((field) => [field, key] as const))
);

type Metadata = Record<string, unknown>;

/**
 * Rebuilds the room state from metadata.
 *
 * The legacy single-key value is read first so a room written by an older
 * version keeps working, then per-group keys layer over it — which is also
 * what makes the migration safe, since a partially-migrated room reads as the
 * union of both.
 */
export function readRoomState(metadata: Metadata): RoomState {
  const legacy = metadata[ROOM_METADATA_KEY] as Partial<RoomState> | undefined;
  let state: RoomState = { ...EMPTY_ROOM_STATE, ...(legacy ?? {}) };

  for (const key of GROUP_KEYS) {
    const group = metadata[key] as Partial<RoomState> | undefined;
    if (group) state = { ...state, ...group };
  }
  return state;
}

/** Whether this room still carries the pre-split single key. */
export function hasLegacyState(metadata: Metadata): boolean {
  return metadata[ROOM_METADATA_KEY] !== undefined;
}

/**
 * The metadata update for a patch: only the groups whose fields actually
 * changed, so untouched concerns are left alone.
 *
 * `migrateAll` writes every group and clears the legacy key. That has to
 * happen in one go — clearing the legacy key while writing only one group
 * would drop whatever the other groups still held there.
 */
export function metadataUpdateFor(
  next: RoomState,
  patch: Partial<RoomState>,
  migrateAll = false
): Metadata {
  const touched = new Set<GroupKey>();
  if (migrateAll) {
    GROUP_KEYS.forEach((key) => touched.add(key));
  } else {
    for (const field of Object.keys(patch) as (keyof RoomState)[]) {
      const owner = OWNER.get(field);
      if (owner) touched.add(owner);
    }
  }

  const update: Metadata = {};
  for (const key of touched) {
    const group: Partial<RoomState> = {};
    for (const field of METADATA_GROUPS[key]) {
      // Assigning through a widened alias: each field is written from the same
      // key it is read from, so the value type always matches.
      (group as Record<string, unknown>)[field] = next[field];
    }
    update[key] = group;
  }

  // Removing the legacy key stops it shadowing later group writes on clients
  // that still read it.
  if (migrateAll) update[ROOM_METADATA_KEY] = undefined;
  return update;
}
