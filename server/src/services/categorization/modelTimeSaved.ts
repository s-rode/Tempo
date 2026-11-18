/**
 * Estimates, per local day, how much model time the decision memo saves.
 *
 * Works only on fields already stored for every event (timestamp, status,
 * attempt count, latency and the two opaque fingerprints); no titles, page text
 * or category names are read.
 *
 * Two figures per day:
 * - observed: events answered without running the model (status `ollama` or
 *   `policy_override` with zero attempts: a memo hit or a request that joined
 *   the running one), each valued at what a model run for that activity cost
 *   that day. Before the memo shipped this is zero.
 * - possible: replays an ideal memo over the day. Any event whose activity and
 *   context (activityKey + classificationContextFingerprint) was successfully
 *   decided by the model in the previous `ttlMs` counts as a repeat. A repeat
 *   that ran the model is valued at its own latency; a hit is valued as above.
 *   This works on days before the memo existed and is an upper bound after it,
 *   because the real key is the full prompt (page text, learning examples) and
 *   the in-process memo is lost when the app restarts.
 */

export interface ModelHistoryEvent {
  timestamp: number;
  classificationStatus?: string | null;
  classificationAttemptCount?: number | null;
  classificationLatencyMs?: number | null;
  activityKey?: string | null;
  classificationContextFingerprint?: string | null;
}

export interface DailyModelTimeSaved {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  /** Events that ran the model at least once. */
  modelRuns: number;
  /** Summed latency of those events. */
  modelMs: number;
  /** Events answered without running the model (memo hit or joined request). */
  observedHits: number;
  observedSavedMs: number;
  /** Events that repeated an activity and context decided in the previous TTL. */
  repeats: number;
  /** Model runs among the repeats: time a perfect memo would also have saved. */
  repeatRuns: number;
  possibleSavedMs: number;
  /** Events reused from stored history (`history` status), shown for context. */
  historyReuses: number;
}

const DECIDED_STATUSES = new Set(['ollama', 'policy_override', 'deterministic_direct']);
const HIT_STATUSES = new Set(['ollama', 'policy_override']);
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const localDayOf = (timestampMs: number): string => {
  const date = new Date(timestampMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const ranModel = (event: ModelHistoryEvent): boolean =>
  (event.classificationAttemptCount ?? 0) > 0 && typeof event.classificationLatencyMs === 'number';

const isHit = (event: ModelHistoryEvent): boolean =>
  (event.classificationAttemptCount ?? 0) === 0 &&
  HIT_STATUSES.has(event.classificationStatus ?? '');

const identityOf = (event: ModelHistoryEvent): string | null =>
  event.activityKey ? `${event.activityKey}|${event.classificationContextFingerprint ?? ''}` : null;

function estimateDay(day: string, events: ModelHistoryEvent[], ttlMs: number): DailyModelTimeSaved {
  // What a successful model run cost, per activity and for the whole day.
  const runCosts = new Map<string, number[]>();
  const allCosts: number[] = [];
  for (const event of events) {
    if (!ranModel(event) || !DECIDED_STATUSES.has(event.classificationStatus ?? '')) continue;
    const latency = event.classificationLatencyMs as number;
    allCosts.push(latency);
    const identity = identityOf(event);
    if (identity) runCosts.set(identity, [...(runCosts.get(identity) ?? []), latency]);
  }
  const dayMedian = median(allCosts) ?? 0;
  const costOf = (identity: string | null) =>
    (identity ? median(runCosts.get(identity) ?? []) : null) ?? dayMedian;

  const result: DailyModelTimeSaved = {
    day,
    modelRuns: 0,
    modelMs: 0,
    observedHits: 0,
    observedSavedMs: 0,
    repeats: 0,
    repeatRuns: 0,
    possibleSavedMs: 0,
    historyReuses: 0,
  };
  // The real memo sets expiry when a decision is stored; a hit does not extend it.
  const decidedAt = new Map<string, number>();
  for (const event of events) {
    const identity = identityOf(event);
    const ran = ranModel(event);
    const hit = isHit(event);
    if (event.classificationStatus === 'history') result.historyReuses += 1;
    if (ran) {
      result.modelRuns += 1;
      result.modelMs += event.classificationLatencyMs as number;
    }
    if (hit) {
      result.observedHits += 1;
      result.observedSavedMs += costOf(identity);
    }
    if (!identity || (!ran && !hit)) continue;
    const previous = decidedAt.get(identity);
    if (previous !== undefined && event.timestamp - previous < ttlMs) {
      result.repeats += 1;
      if (ran) result.repeatRuns += 1;
      result.possibleSavedMs += ran ? (event.classificationLatencyMs as number) : costOf(identity);
    } else if (ran && DECIDED_STATUSES.has(event.classificationStatus ?? '')) {
      decidedAt.set(identity, event.timestamp);
    }
  }
  result.modelMs = Math.round(result.modelMs);
  result.observedSavedMs = Math.round(result.observedSavedMs);
  result.possibleSavedMs = Math.round(result.possibleSavedMs);
  return result;
}

export function estimateModelTimeSaved(
  events: ModelHistoryEvent[],
  {
    ttlMs = DEFAULT_TTL_MS,
    dayOf = localDayOf,
  }: { ttlMs?: number; dayOf?: (ms: number) => string } = {}
): DailyModelTimeSaved[] {
  const byDay = new Map<string, ModelHistoryEvent[]>();
  for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    const day = dayOf(event.timestamp);
    byDay.set(day, [...(byDay.get(day) ?? []), event]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, dayEvents]) => estimateDay(day, dayEvents, ttlMs));
}
