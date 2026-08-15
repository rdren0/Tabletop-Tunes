import { useEffect, useRef, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { EMPTY_ROOM_STATE, ROOM_METADATA_KEY, RoomState } from "../types";

/** True once the extension is confirmed to be running inside Owlbear Rodeo. */
export function useObrReady(): boolean {
  const [ready, setReady] = useState(OBR.isReady);
  useEffect(() => OBR.onReady(() => setReady(true)), []);
  return ready;
}

/** Whether the current player is the GM of this room. */
export function useIsGM(ready: boolean): boolean {
  const [isGM, setIsGM] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let unsubscribed = false;
    OBR.player.getRole().then((role) => {
      if (!unsubscribed) setIsGM(role === "GM");
    });
    return OBR.player.onChange((player) => setIsGM(player.role === "GM"));
  }, [ready]);
  return isGM;
}

/** The current player's stable id (synchronous once the extension is ready). */
export function usePlayerId(ready: boolean): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    setId(OBR.player.id);
  }, [ready]);
  return id;
}

/** The current player's display name, so their requests can be attributed. */
export function usePlayerName(ready: boolean): string {
  const [name, setName] = useState("Someone");
  useEffect(() => {
    if (!ready) return;
    let unsubscribed = false;
    OBR.player.getName().then((value) => {
      if (!unsubscribed) setName(value || "Someone");
    });
    return OBR.player.onChange((player) => setName(player.name || "Someone"));
  }, [ready]);
  return name;
}

/** Smallest sensible popover, so a momentarily empty panel isn't a sliver. */
const MIN_POPOVER_HEIGHT = 180;
/** Beyond this the panel stops growing and its queue scrolls instead. */
const MAX_POPOVER_HEIGHT = 900;

/**
 * Sizes the action popover to whatever the panel actually needs. The manifest
 * height is a single fixed number, which leaves a tall empty box under a short
 * queue — Owlbear lets an extension resize its own popover at runtime, so the
 * frame can follow the content instead.
 *
 * Returns a ref to attach to the root element.
 */
export function useAutoHeight(ready: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ready) return;
    const element = ref.current;
    if (!element) return;

    let last = 0;
    const observer = new ResizeObserver(() => {
      const measured = Math.ceil(element.getBoundingClientRect().height);
      const height = Math.min(Math.max(measured, MIN_POPOVER_HEIGHT), MAX_POPOVER_HEIGHT);
      // Each call is a round trip through Owlbear, and the embed's
      // aspect-ratio box produces sub-pixel churn on every reflow.
      if (Math.abs(height - last) < 2) return;
      last = height;
      OBR.action.setHeight(height).catch(() => {
        // Resizing is a nicety; a refused call just leaves the manifest size.
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready]);
  return ref;
}

export interface PartyMember {
  id: string;
  name: string;
  role: "GM" | "PLAYER";
}

/** Every other connected player in the room (excludes the local client). */
export function useParty(ready: boolean): PartyMember[] {
  const [party, setParty] = useState<PartyMember[]>([]);
  useEffect(() => {
    if (!ready) return;
    let unsubscribed = false;
    OBR.party.getPlayers().then((players) => {
      if (!unsubscribed) setParty(players);
    });
    return OBR.party.onChange((players) => setParty(players));
  }, [ready]);
  return party;
}

/**
 * Shared playback state, stored in room metadata so it's synced to every
 * connected client and persists for the room (survives reloads/reconnects).
 * Returns the current state plus a setter that merges and broadcasts updates.
 */
export function useRoomState(
  ready: boolean
): [RoomState, (patch: Partial<RoomState>) => void] {
  const [state, setState] = useState<RoomState>(EMPTY_ROOM_STATE);
  // Track the latest state locally so rapid patches (e.g. add-to-queue then
  // immediately play) don't race against the async round-trip to room metadata.
  const latest = useRef<RoomState>(EMPTY_ROOM_STATE);

  useEffect(() => {
    if (!ready) return;
    let unsubscribed = false;

    OBR.room.getMetadata().then((metadata) => {
      const existing = metadata[ROOM_METADATA_KEY] as Partial<RoomState> | undefined;
      if (existing && !unsubscribed) {
        const merged = { ...EMPTY_ROOM_STATE, ...existing };
        latest.current = merged;
        setState(merged);
      }
    });

    return OBR.room.onMetadataChange((metadata) => {
      const next = metadata[ROOM_METADATA_KEY] as Partial<RoomState> | undefined;
      if (next) {
        const merged = { ...EMPTY_ROOM_STATE, ...next };
        latest.current = merged;
        setState(merged);
      }
    });
  }, [ready]);

  function patchState(patch: Partial<RoomState>) {
    const next: RoomState = { ...latest.current, ...patch, updatedAt: Date.now() };
    latest.current = next;
    setState(next);
    OBR.room.setMetadata({ [ROOM_METADATA_KEY]: next });
  }

  return [state, patchState];
}
