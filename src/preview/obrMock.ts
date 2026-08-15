/**
 * A stand-in for the Owlbear SDK so the panel can be rendered in a plain
 * browser tab. Aliased over `@owlbear-rodeo/sdk` by vite.preview.config.ts and
 * never part of the production build, which resolves the real package.
 *
 * It implements only the surface App actually touches. Everything is in
 * memory: "room metadata" is a variable, and the subscription callbacks are
 * invoked directly, which is enough to exercise the real code paths for
 * theming, role, sync and resizing.
 */

type Role = "GM" | "PLAYER";
type ThemeMode = "LIGHT" | "DARK";
type Listener<T> = (value: T) => void;

interface PartyMember {
  id: string;
  name: string;
  role: Role;
}

function makeTheme(mode: ThemeMode) {
  const dark = mode === "DARK";
  return {
    mode,
    primary: { light: "#8b6ff8", main: "#6741d9", dark: "#4a2ea8", contrastText: "#ffffff" },
    secondary: { light: "#8b6ff8", main: "#6741d9", dark: "#4a2ea8", contrastText: "#ffffff" },
    background: { default: dark ? "#1e1e24" : "#ffffff", paper: dark ? "#26262e" : "#f1f1f5" },
    text: {
      primary: dark ? "#f2f2f5" : "#1a1a1f",
      secondary: dark ? "#c2c2cc" : "#45454f",
      disabled: dark ? "#7a7a86" : "#8a8a96",
    },
  };
}

const state = {
  role: "GM" as Role,
  mode: "DARK" as ThemeMode,
  roomMetadata: {} as Record<string, unknown>,
  playerMetadata: {} as Record<string, unknown>,
  party: [
    { id: "player-ana", name: "Ana", role: "PLAYER" as Role },
    { id: "player-bo", name: "Bo", role: "PLAYER" as Role },
  ] as PartyMember[],
};

const roomListeners = new Set<Listener<Record<string, unknown>>>();
const themeListeners = new Set<Listener<ReturnType<typeof makeTheme>>>();
const playerListeners = new Set<Listener<{ id: string; name: string; role: Role }>>();
const partyListeners = new Set<Listener<PartyMember[]>>();

function self() {
  return { id: "player-me", name: "You", role: state.role };
}

function subscribe<T>(set: Set<Listener<T>>, callback: Listener<T>) {
  set.add(callback);
  return () => set.delete(callback);
}

const OBR = {
  isReady: true,
  onReady(callback: () => void) {
    // Async, like the real SDK, so `ready`-gated effects run in the same order.
    const id = window.setTimeout(callback, 0);
    return () => window.clearTimeout(id);
  },
  room: {
    async getMetadata() {
      return state.roomMetadata;
    },
    async setMetadata(update: Record<string, unknown>) {
      state.roomMetadata = { ...state.roomMetadata, ...update };
      roomListeners.forEach((l) => l(state.roomMetadata));
    },
    onMetadataChange(callback: Listener<Record<string, unknown>>) {
      return subscribe(roomListeners, callback);
    },
  },
  player: {
    get id() {
      return self().id;
    },
    async getId() {
      return self().id;
    },
    async getName() {
      return self().name;
    },
    async getRole(): Promise<Role> {
      return state.role;
    },
    async getMetadata() {
      return state.playerMetadata;
    },
    async setMetadata(update: Record<string, unknown>) {
      state.playerMetadata = { ...state.playerMetadata, ...update };
    },
    onChange(callback: Listener<{ id: string; name: string; role: Role }>) {
      return subscribe(playerListeners, callback);
    },
  },
  party: {
    async getPlayers() {
      return state.party;
    },
    onChange(callback: Listener<PartyMember[]>) {
      return subscribe(partyListeners, callback);
    },
  },
  theme: {
    async getTheme() {
      return makeTheme(state.mode);
    },
    onChange(callback: Listener<ReturnType<typeof makeTheme>>) {
      return subscribe(themeListeners, callback);
    },
  },
  action: {
    async setHeight(height: number) {
      // The harness shows this rather than resizing anything, so the
      // auto-height maths stays visible.
      window.dispatchEvent(new CustomEvent("preview:height", { detail: height }));
    },
  },
};

/** Harness controls, driven by the toolbar in main.tsx. */
export const preview = {
  setTheme(mode: ThemeMode) {
    state.mode = mode;
    themeListeners.forEach((l) => l(makeTheme(mode)));
  },
  setRole(role: Role) {
    state.role = role;
    playerListeners.forEach((l) => l(self()));
  },
  seedRoom(metadata: Record<string, unknown>) {
    state.roomMetadata = metadata;
    roomListeners.forEach((l) => l(state.roomMetadata));
  },
  get role() {
    return state.role;
  },
};

export default OBR;
