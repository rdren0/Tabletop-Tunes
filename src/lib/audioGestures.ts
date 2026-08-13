/**
 * Browsers only honour audio changes inside the user gesture that triggered
 * them, and with several players running at once a single click has to reach
 * all of them synchronously. Players register here; the volume controls call
 * `unmuteAll` directly from their click handler.
 */
type UnmuteTarget = () => void;

const targets = new Set<UnmuteTarget>();

export function registerUnmuteTarget(target: UnmuteTarget): () => void {
  targets.add(target);
  return () => {
    targets.delete(target);
  };
}

export function unmuteAll(): void {
  targets.forEach((target) => target());
}

/**
 * Anything with no clickable surface of its own — the ambience layers are
 * 1px and invisible — can never receive a gesture directly. Registering here
 * lets any click in the popover stand in for one.
 */
const gestureTargets = new Set<UnmuteTarget>();

export function registerGestureTarget(target: UnmuteTarget): () => void {
  gestureTargets.add(target);
  return () => {
    gestureTargets.delete(target);
  };
}

export function notifyGesture(): void {
  gestured = true;
  gestureTargets.forEach((target) => target());
}

let gestured = false;
const pageLoadedAt = Date.now();

/**
 * Nothing may start playing merely because a panel opened onto a room that
 * happens to be mid-track — that lands as audio blaring out of nowhere. Sound
 * needs either a click on this client, or a change that arrived while the
 * listener was already sitting there.
 */
export function mayAutoStart(): boolean {
  return gestured || Date.now() - pageLoadedAt > 2500;
}
