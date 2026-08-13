/**
 * Asks the browser up front whether it will start audio without a gesture,
 * the same trick the `can-autoplay` library uses: try to play a scrap of
 * silent audio and see whether the promise resolves or rejects.
 *
 * Knowing this in advance means a browser that permits autoplay — which a
 * regular Owlbear user's Chrome generally does, since permission follows the
 * engagement score for the site — never sees a fallback control, while one
 * that refuses can be offered a real play button immediately instead of after
 * several seconds of silent retrying.
 */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

let probe: Promise<boolean> | null = null;

export function autoplayAllowed(): Promise<boolean> {
  if (probe) return probe;
  probe = new Promise<boolean>((resolve) => {
    try {
      const audio = document.createElement("audio");
      audio.src = SILENT_WAV;
      audio.volume = 0;
      const attempt = audio.play();
      if (attempt === undefined) {
        // Older browsers return nothing; assume permitted and let the retry
        // path sort it out.
        resolve(true);
        return;
      }
      attempt
        .then(() => {
          audio.pause();
          resolve(true);
        })
        .catch(() => resolve(false));
    } catch {
      resolve(false);
    }
  });
  return probe;
}
