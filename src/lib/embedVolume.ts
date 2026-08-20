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
  /** When we last handed the embed a volume, in epoch ms. */
  pushedAt: number;
  /** What it reported for that push, or null while we're still waiting. */
  echoed: number | null;
}

/** Nothing pushed yet: whatever the embed opens at is the baseline. */
export const initialEcho: EchoState = { pushedAt: 0, echoed: null };

/** Call whenever a volume is handed to the embed. */
export function pushed(now: number): EchoState {
  return { pushedAt: now, echoed: null };
}

/**
 * Fold one read-back into the state. `moved` means a person moved the embed's
 * own volume control and our side should follow them to `lived`.
 */
export function observed(
  state: EchoState,
  lived: number,
  now: number
): { state: EchoState; moved: boolean } {
  if (now - state.pushedAt < VOLUME_SETTLE_MS) {
    // Too soon after a push to know whose number this is: the value read here
    // is updated over the embed's message channel, and until that lands it can
    // still be reporting what the player held before.
    return { state: { ...state, echoed: null }, moved: false };
  }
  if (state.echoed === null) {
    // The first settled look after a push is that push coming back.
    return { state: { ...state, echoed: lived }, moved: false };
  }
  if (Math.abs(lived - state.echoed) <= TOLERANCE) return { state, moved: false };
  return { state: { ...state, echoed: lived }, moved: true };
}
