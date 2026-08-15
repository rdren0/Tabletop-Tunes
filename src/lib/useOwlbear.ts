import { useEffect, useRef, useState } from "react";
import OBR, { Player } from "@owlbear-rodeo/sdk";
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

/**
 * Mirrors Owlbear's light/dark setting onto the document, which the stylesheet
 * keys off via `[data-theme]`.
 *
 * Deliberately not `prefers-color-scheme`: Owlbear's theme is its own setting,
 * independent of the operating system's, so a media query would disagree with
 * the app surrounding this panel as often as it agreed.
 */
export function useObrTheme(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const apply = (mode: "LIGHT" | "DARK") => {
      document.documentElement.dataset.theme = mode === "LIGHT" ? "light" : "dark";
    };
    OBR.theme
      .getTheme()
      .then((theme) => apply(theme.mode))
      .catch(() => {
        // Unreadable theme just leaves the dark default in place.
      });
    return OBR.theme.onChange((theme) => apply(theme.mode));
  }, [ready]);
}

/** Smallest sensible popover, so a momentarily empty panel isn't a sliver. */
const MIN_POPOVER_HEIGHT = 180;

/**
 * How tall the popover may grow. Derived from the screen rather than a fixed
 * number, because a fixed ceiling turns into a scrollbar the moment the panel
 * needs more room — which is exactly the thing sizing-to-content is meant to
 * avoid. The margin leaves space for Owlbear's own chrome and the browser's.
 *
 * `screen.availHeight` is readable from inside the iframe; `window.innerHeight`
 * is not useful here, since that's the popover's current height, not the room
 * available to it.
 */
function maxPopoverHeight(): number {
  const screenHeight = window.screen?.availHeight;
  if (!screenHeight) return 900;
  return Math.max(MIN_POPOVER_HEIGHT, screenHeight - 160);
}

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
      const height = Math.min(Math.max(measured, MIN_POPOVER_HEIGHT), maxPopoverHeight());
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
  /** Epoch ms this player's panel last checked in, or null if it never has. */
  presentAt: number | null;
}

/**
 * Being in the room and having this panel open are different things — Owlbear
 * destroys the extension's iframe whenever the popover is closed. Anything that
 * needs a client to actually be *running* (advancing the queue, tidying up
 * metadata) has to know which is which.
 *
 * Presence lives in each player's own metadata rather than the shared room key,
 * so these frequent writes can't collide with anyone else's.
 */
const PRESENCE_KEY = "rodeo.tabletoptunes/presence";
const PRESENCE_INTERVAL_MS = 15_000;
/** Three missed beats before a client counts as gone. */
export const PRESENCE_TTL_MS = 50_000;

/** Whether a party member's panel is open and running right now. */
export function hasPanelOpen(member: PartyMember): boolean {
  return member.presentAt !== null && Date.now() - member.presentAt < PRESENCE_TTL_MS;
}

/** Publishes this client's own presence for as long as the panel is open. */
export function usePresence(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const beat = () => {
      OBR.player.setMetadata({ [PRESENCE_KEY]: Date.now() }).catch(() => {});
    };
    beat();
    const timer = window.setInterval(beat, PRESENCE_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      // Best-effort: the popover closing destroys this frame, so the write may
      // not land. The TTL is what actually guarantees the mark expires.
      OBR.player.setMetadata({ [PRESENCE_KEY]: undefined }).catch(() => {});
    };
  }, [ready]);
}

/** Every other connected player in the room (excludes the local client). */
export function useParty(ready: boolean): PartyMember[] {
  const [party, setParty] = useState<PartyMember[]>([]);
  useEffect(() => {
    if (!ready) return;
    let unsubscribed = false;
    const toMembers = (players: Player[]): PartyMember[] =>
      players.map((p) => {
        const beat = p.metadata?.[PRESENCE_KEY];
        return {
          id: p.id,
          name: p.name,
          role: p.role,
          presentAt: typeof beat === "number" ? beat : null,
        };
      });
    OBR.party.getPlayers().then((players) => {
      if (!unsubscribed) setParty(toMembers(players));
    });
    return OBR.party.onChange((players) => setParty(toMembers(players)));
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
