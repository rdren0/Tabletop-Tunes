/**
 * Sizing maths for the action popover, kept apart from the DOM and the SDK so
 * it can be reasoned about — and tested — on its own.
 */

/** Smallest sensible popover, so a momentarily empty panel isn't a sliver. */
export const MIN_POPOVER_HEIGHT = 180;

/** Leaves room for Owlbear's chrome and the browser's around the popover. */
const SCREEN_MARGIN = 160;

/** Fallback when the screen can't be read at all. */
const FALLBACK_MAX = 900;

/**
 * How tall the popover may grow. Derived from the screen rather than a fixed
 * number, because a fixed ceiling becomes a scrollbar the moment the panel
 * needs more room — the exact thing sizing-to-content exists to avoid.
 *
 * `screen.availHeight` is the right input: `window.innerHeight` is the
 * popover's *current* height, which would pin the maximum to wherever it
 * happens to be.
 */
export function maxPopoverHeight(availHeight?: number): number {
  if (!availHeight || !Number.isFinite(availHeight)) return FALLBACK_MAX;
  return Math.max(MIN_POPOVER_HEIGHT, Math.round(availHeight - SCREEN_MARGIN));
}

export interface PanelMeasurement {
  /** The panel's rendered height, which its own CSS caps at the viewport. */
  panelHeight: number;
  /** Queue content currently scrolled out of sight, i.e. room it still wants. */
  hiddenQueue: number;
}

/**
 * The height to ask Owlbear for.
 *
 * The panel is capped at the viewport so the queue scrolls instead of the
 * page, which means the panel's own height stops reporting how much room the
 * contents actually want as soon as that cap is hit. Whatever the queue is
 * hiding is exactly that shortfall, so adding it back recovers the real
 * figure. Growing the popover then reveals more queue, shrinking the hidden
 * amount — the two converge rather than oscillating.
 */
export function popoverHeightFor(measurement: PanelMeasurement, max: number): number {
  const wanted = measurement.panelHeight + Math.max(0, measurement.hiddenQueue);
  return Math.min(Math.max(Math.ceil(wanted), MIN_POPOVER_HEIGHT), Math.max(max, MIN_POPOVER_HEIGHT));
}

/** Reads the two numbers above off the live panel. */
export function measurePanel(element: HTMLElement): PanelMeasurement {
  const queue = element.querySelector<HTMLElement>(".queue");
  return {
    panelHeight: element.getBoundingClientRect().height,
    hiddenQueue: queue ? queue.scrollHeight - queue.clientHeight : 0,
  };
}
