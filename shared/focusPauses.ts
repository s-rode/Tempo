/**
 * A stretch of a work phase the person paused on purpose: with Pause in the
 * queue, the toolbar or the notch, or for a calendar event. While it lasts the
 * phase clock stands still, so it is never task, goal or focus time. An open
 * pause (`endedAtMs` null) is still going on.
 */
export interface FocusPause {
  startedAtMs: number;
  endedAtMs: number | null;
  reason: 'manual' | 'calendar';
}

export interface TimeWindow {
  startMs: number;
  endMs: number;
}

/** A pause shorter than this is a double click, not a pause worth drawing. */
export const MIN_VISIBLE_PAUSE_MS = 1000;

/**
 * The parts of `startMs`–`endMs` that were not paused, in time order. An open
 * pause runs to `endMs`, so a session paused right now ends at its pause.
 */
export const workWindows = (
  startMs: number,
  endMs: number,
  pauses: readonly FocusPause[] | null | undefined
): TimeWindow[] => {
  if (!(endMs > startMs)) return [];
  const cuts = (pauses || [])
    .map((pause) => ({
      startMs: Math.max(startMs, pause.startedAtMs),
      endMs: Math.min(endMs, pause.endedAtMs ?? endMs),
    }))
    .filter((pause) => pause.endMs - pause.startMs >= MIN_VISIBLE_PAUSE_MS)
    .sort((left, right) => left.startMs - right.startMs);
  const windows: TimeWindow[] = [];
  let cursor = startMs;
  for (const cut of cuts) {
    if (cut.startMs > cursor) windows.push({ startMs: cursor, endMs: cut.startMs });
    cursor = Math.max(cursor, cut.endMs);
  }
  if (endMs > cursor) windows.push({ startMs: cursor, endMs });
  return windows;
};

/** How long a phase was paused inside `startMs`–`endMs`. */
export const pausedWithin = (
  startMs: number,
  endMs: number,
  pauses: readonly FocusPause[] | null | undefined
): number =>
  Math.max(0, endMs - startMs) -
  workWindows(startMs, endMs, pauses).reduce(
    (sum, window) => sum + window.endMs - window.startMs,
    0
  );
