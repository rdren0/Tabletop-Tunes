import { useCallback, useEffect, useRef, useState } from "react";
import OBR, { Player } from "@owlbear-rodeo/sdk";
import { maxPopoverHeight, measurePanel, popoverHeightFor } from "./popoverHeight";
import { AdvancerCandidate, PRESENCE_TTL_MS } from "./advancer";
import { EMPTY_ROOM_STATE, RoomState } from "../types";
import { hasLegacyState, metadataUpdateFor, readRoomState } from "./roomMetadata";

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

/**
 * Sizes the action popover to whatever the panel actually needs. A manifest
 * declares a single fixed height, which leaves a tall empty box under a short
 * queue; Owlbear lets an extension resize its own popover at runtime instead.
 *
 * Returns a ref to attach to the root element.
 */
export function useAutoHeight(ready: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const lastSent = useRef(0);

  const sync = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const height = popoverHeightFor(measurePanel(element), maxPopoverHeight(window.screen?.availHeight));
    // Each call is a round trip through Owlbear, and the embed's aspect-ratio
    // box produces sub-pixel churn on every reflow.
    if (Math.abs(height - lastSent.current) < 2) return;
    lastSent.current = height;
    OBR.action.setHeight(height).catch(() => {
      // Resizing is a nicety; a refused call just leaves the manifest size.
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready, sync]);

  // The panel is capped at the viewport, so its contents can change without
  // its own size changing at all — adding a track while the queue is already
  // scrolling, or opening the support section. A ResizeObserver sees nothing
  // in those cases, so re-check after every render too.
  useEffect(() => {
    if (ready) sync();
  });

  return ref;
}

export interface PartyMember extends AdvancerCandidate {
  name: string;
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
const PRESENCE_INTERVAL_MS = PRESENCE_TTL_MS / 3;
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
 *
 * State is split across several metadata keys by concern — see roomMetadata.ts
 * — so writes about different things cannot discard one another.
 */
export function useRoomState(
  ready: boolean
): [RoomState, (patch: Partial<RoomState>) => void] {
  const [state, setState] = useState<RoomState>(EMPTY_ROOM_STATE);
  // Track the latest state locally so rapid patches (e.g. add-to-queue then
  // immediately play) don't race against the async round-trip to room metadata.
  const latest = useRef<RoomState>(EMPTY_ROOM_STATE);
  // Set while this room still holds the pre-split key, so the next write can
  // migrate it wholesale rather than leaving half the state behind.
  const needsMigration = useRef(false);

  useEffect(() => {
    if (!ready) return;
    let unsubscribed = false;

    OBR.room.getMetadata().then((metadata) => {
      if (unsubscribed) return;
      needsMigration.current = hasLegacyState(metadata);
      const merged = readRoomState(metadata);
      latest.current = merged;
      setState(merged);
    });

    return OBR.room.onMetadataChange((metadata) => {
      needsMigration.current = hasLegacyState(metadata);
      const merged = readRoomState(metadata);
      latest.current = merged;
      setState(merged);
    });
  }, [ready]);

  function patchState(patch: Partial<RoomState>) {
    const next: RoomState = { ...latest.current, ...patch };
    latest.current = next;
    setState(next);

    const migrating = needsMigration.current;
    needsMigration.current = false;
    OBR.room.setMetadata(metadataUpdateFor(next, patch, migrating));
  }

  return [state, patchState];
}
