/**
 * Whether the room *started* playback while this client was watching, as
 * opposed to this panel opening onto a room that was already mid-track. Only
 * the first of those may begin audio nobody at this browser asked for.
 *
 * Two things make this easy to get wrong, and both were:
 *
 * - Before the room's metadata has been read, the state is the empty default,
 *   which looks exactly like a paused, empty room. Counting that as "seen it
 *   paused" makes every late joiner qualify.
 * - The player embed only exists while something is queued, so it cannot judge
 *   this for itself: adding a first track to an empty queue starts playback
 *   and mounts the embed in the same breath, which from inside the embed is
 *   indistinguishable from arriving late.
 *
 * Hence a small piece of state that lives above the embed and is fed every
 * observation of the room, mounted or not.
 */
export interface StartWatch {
  /** True once the room has been seen genuinely paused (or empty). */
  sawPaused: boolean;
  /** True once playback has begun since then — the signal callers want. */
  started: boolean;
}

export const initialWatch: StartWatch = { sawPaused: false, started: false };

/**
 * Folds one observation of the room into the watch. `loaded` is whether the
 * room's own metadata has actually been read yet; anything before that says
 * nothing about the room and is ignored.
 */
export function observedRoom(
  watch: StartWatch,
  { loaded, isPlaying }: { loaded: boolean; isPlaying: boolean }
): StartWatch {
  if (!loaded) return watch;
  if (!isPlaying) return watch.sawPaused ? watch : { ...watch, sawPaused: true };
  // Playing, and this client saw the room quiet beforehand: somebody started
  // it just now. Once true it stays true — the permission it grants is not
  // spent by the next pause.
  if (!watch.sawPaused || watch.started) return watch;
  return { ...watch, started: true };
}
