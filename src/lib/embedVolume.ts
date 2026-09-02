/**
 * Reading the volume back out of the YouTube embed.
 *
 * The embed carries its own speaker control, and someone using it writes
 * straight to the player where nothing here would ever see it — so the
 * heartbeat reads the volume back and mirrors it into our own slider.
 *
 * The trap is that the embed does not necessarily keep the number it is
 * handed. It rounds, and at the quiet end it rounds by more than a single
 * step, so a read-back compared against *our* number looks like an adjustment
 * that nobody made. That is what pulled anyone who asked for a level below
 * about 5% back up to it a couple of seconds later, over and over: the slider
 * moved, the readout followed, and the volume they actually wanted never
 * survived long enough to be heard.
 *
 * So the read-back is compared against the embed's own echo of our last push
 * instead. Whatever it says after it has settled *is* that push, however it
 * chose to round it, and only a later departure from that is a human hand.
 */

/** Long enough for a push to come back through the embed's message channel. */
export const VOLUME_SETTLE_MS = 3000;

/** A rounding step either way is the embed, not somebody moving a slider. */
const TOLERANCE = 1;

export interface EchoState {
  /** When we last handed the embed its audio settings, in epoch ms. */
  pushedAt: number;
  /** The volume it reported for that push, or null while we're still waiting. */
  echoed: number | null;
  /** The mute it reported for that push, or null while we're still waiting. */
  echoedMuted: boolean | null;
}

/** Nothing pushed yet: whatever the embed opens at is the baseline. */
export const initialEcho: EchoState = { pushedAt: 0, echoed: null, echoedMuted: null };

/** Call whenever volume or mute is handed to the embed. */
export function pushed(now: number): EchoState {
  return { pushedAt: now, echoed: null, echoedMuted: null };
}

/**
 * Fold one read-back into the state. A `moved` flag means a person worked the
 * embed's own control and our side should follow them.
 *
 * Mute is held to exactly the same discipline as volume, and for the same
 * reason. `isMuted()` reads a value the API caches from the frame's messages,
 * so for a moment after `mute()` it still answers with what the player held
 * before. Comparing that against what we had just asked for reported a change
 * nobody made — and the panel, following its own player, promptly unmuted
 * itself. That is why mute appeared not to work at all: every press was undone
 * by the read-back a tick later, and so was every drag to zero, since zero is
 * carried as mute.
 */
export function observed(
  state: EchoState,
  lived: number,
  livedMuted: boolean,
  now: number
): { state: EchoState; moved: boolean; muteMoved: boolean } {
  if (now - state.pushedAt < VOLUME_SETTLE_MS) {
    // Too soon after a push to know whose values these are: they are updated
    // over the embed's message channel, and until that lands they can still be
    // reporting what the player held before.
    return {
      state: { ...state, echoed: null, echoedMuted: null },
      moved: false,
      muteMoved: false,
    };
  }
  if (state.echoed === null || state.echoedMuted === null) {
    // The first settled look after a push is that push coming back.
    return {
      state: { ...state, echoed: lived, echoedMuted: livedMuted },
      moved: false,
      muteMoved: false,
    };
  }
  const moved = Math.abs(lived - state.echoed) > TOLERANCE;
  const muteMoved = livedMuted !== state.echoedMuted;
  if (!moved && !muteMoved) return { state, moved: false, muteMoved: false };
  return {
    state: { ...state, echoed: moved ? lived : state.echoed, echoedMuted: livedMuted },
    moved,
    muteMoved,
  };
}

/**
 * Whether the embed should be told to mute, given what this listener has asked
 * for.
 *
 * A volume of zero has to be carried as mute rather than as a number, because
 * the embed will not hold it: `setVolume(0)` trips YouTube's own mute flag, and
 * the `unMute()` that follows — sent because *our* mute is off — restores the
 * level from before it. Dragging the slider to the bottom therefore left the
 * track playing on at whatever it had been, with the readout claiming 0%.
 */
export function shouldMute(volume: number, muted: boolean): boolean {
  return muted || !(volume > 0);
}
