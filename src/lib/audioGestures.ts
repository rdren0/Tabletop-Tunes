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
