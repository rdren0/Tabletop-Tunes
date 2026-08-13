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

/**
 * Whether this listener has clicked anything in the popover yet.
 *
 * Nothing may start playing merely because a panel opened onto a room that
 * happens to be mid-track. Elapsed time is *not* a substitute: a client left
 * sitting there would silently qualify and start on its own, which is exactly
 * the unprompted audio being avoided. Callers pair this with an explicit
 * signal that the room started something while they were watching.
 */
export function hasGestured(): boolean {
  return gestured;
}
