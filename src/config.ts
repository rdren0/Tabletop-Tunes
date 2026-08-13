/**
 * Whether Spotify links can be queued.
 *
 * Spotify only plays for listeners signed into their own account (free
 * accounts hear 30-second previews), and its embed exposes neither volume nor
 * seek control — so Spotify tracks sit out the volume, mute, and position
 * features. Whoever adds the first Spotify link of a session gets a warning
 * saying so. Set to false to accept YouTube links only.
 */
export const SPOTIFY_ENABLED = false;

/**
 * Whether the ambience layers are usable. Switched off while the autoplay
 * behaviour is settled: the section still shows, marked as coming soon, so
 * the feature is visibly parked rather than silently missing. The players and
 * their controls are untouched behind this.
 */
export const AMBIENCE_ENABLED = false;
