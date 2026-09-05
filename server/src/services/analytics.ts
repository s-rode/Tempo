import type { ActiveWindowEvent, Category } from '../../../shared/types';

export interface AnalyticsDuration {
  focusedMs: number;
  distractedMs: number;
  uncertainMs: number;
}

export interface AnalyticsDay extends AnalyticsDuration {
  startDateMs: number;
  appSwitches: number;
  categoryTotals: Array<{ categoryId: string; name: string; color: string; isProductive: boolean; durationMs: number }>;
}

export interface AnalyticsHour extends AnalyticsDuration {
  hour: number;
}

export interface PeriodAnalytics {
  days: AnalyticsDay[];
  hours: AnalyticsHour[];
  totals: AnalyticsDuration & { trackedMs: number; appSwitches: number };
  categoryTotals: AnalyticsDay['categoryTotals'];
}

export type FocusComparisonMode = 'all_active_days' | 'same_day_type' | 'same_weekday';

const SYSTEM_EVENT_NAMES = new Set(['System Sleep', 'System Wake', 'System Lock', 'System Unlock']);
// Mirrors the renderer's processed-event ceiling. It preserves normal long
// study visits while avoiding legacy intervals that span a missed sleep/lock.
const MAX_CONTINUOUS_ACTIVITY_MS = 4 * 60 * 60 * 1000;

const emptyDuration = (): AnalyticsDuration => ({ focusedMs: 0, distractedMs: 0, uncertainMs: 0 });

const addDuration = (target: AnalyticsDuration, productive: boolean | undefined, durationMs: number) => {
  if (productive === true) target.focusedMs += durationMs;
  else if (productive === false) target.distractedMs += durationMs;
  else target.uncertainMs += durationMs;
};

const dayStart = (value: number) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const nextBoundary = (value: number) => {
  const date = new Date(value);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
};

/**
 * Converts the same activity-event intervals used by Tempo's timeline into
 * calendar-day and hour buckets. It intentionally receives already-local
 * timestamps; the bundled local server runs in the user's macOS timezone.
 */
export const calculatePeriodAnalytics = (
  events: ActiveWindowEvent[],
  categories: Category[],
  startDateMs: number,
  endDateMs: number,
  nowMs = Date.now()
): PeriodAnalytics => {
  // `.lean()` deliberately bypasses the schema's toJSON transform, so Mongo
  // returns category `_id`s as ObjectIds here while activity events store the
  // reference as a string. Normalize at the analytics boundary.
  const normalizedCategories = categories.map((category) => ({ ...category, _id: String(category._id) }));
  const categoriesById = new Map(normalizedCategories.map((category) => [category._id, category]));
  const days = new Map<number, AnalyticsDay>();
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, ...emptyDuration() }));
  const periodCategoryTotals = new Map<string, AnalyticsDay['categoryTotals'][number]>();
  const totals = { ...emptyDuration(), trackedMs: 0, appSwitches: 0 };
  const sorted = [...events].sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0));

  const ensureDay = (timestamp: number) => {
    const key = dayStart(timestamp);
    const existing = days.get(key);
    if (existing) return existing;
    const day: AnalyticsDay = { startDateMs: key, appSwitches: 0, categoryTotals: [], ...emptyDuration() };
    days.set(key, day);
    return day;
  };
  for (let cursor = startDateMs; cursor < endDateMs; cursor = nextBoundary(cursor)) ensureDay(cursor);

  let previousApp: string | null = null;
  for (let index = 0; index < sorted.length; index += 1) {
    const event = sorted[index];
    const timestamp = event.timestamp || 0;
    const isSystem = event.type === 'system' || SYSTEM_EVENT_NAMES.has(event.ownerName);
    if (isSystem) {
      previousApp = null;
      continue;
    }
    const nextTimestamp = sorted[index + 1]?.timestamp;
    const intervalEnd = Math.min(nextTimestamp ?? nowMs, timestamp + MAX_CONTINUOUS_ACTIVITY_MS, endDateMs, nowMs);
    const intervalStart = Math.max(timestamp, startDateMs);
    if (intervalEnd <= intervalStart) continue;

    // An application switch is deliberately app-only: browser tabs and
    // repeated samples carry the same owner name and never raise this count.
    if (timestamp >= startDateMs && timestamp < endDateMs && previousApp && previousApp !== event.ownerName) {
      ensureDay(timestamp).appSwitches += 1;
      totals.appSwitches += 1;
    }
    previousApp = event.ownerName;

    const category = event.categoryId ? categoriesById.get(String(event.categoryId)) : undefined;
    let sliceStart = intervalStart;
    while (sliceStart < intervalEnd) {
      const hourEnd = new Date(sliceStart);
      hourEnd.setMinutes(60, 0, 0);
      const sliceEnd = Math.min(intervalEnd, nextBoundary(sliceStart), hourEnd.getTime());
      const durationMs = sliceEnd - sliceStart;
      const day = ensureDay(sliceStart);
      addDuration(day, category?.isProductive, durationMs);
      addDuration(hours[new Date(sliceStart).getHours()], category?.isProductive, durationMs);
      addDuration(totals, category?.isProductive, durationMs);
      totals.trackedMs += durationMs;
      if (category) {
        const existing = periodCategoryTotals.get(category._id) || {
          categoryId: category._id,
          name: category.name,
          color: category.color,
          isProductive: category.isProductive,
          durationMs: 0
        };
        existing.durationMs += durationMs;
        periodCategoryTotals.set(category._id, existing);
      }
      sliceStart = sliceEnd;
    }
  }

  for (const day of days.values()) {
    const dayCategories = new Map<string, AnalyticsDay['categoryTotals'][number]>();
    for (const event of sorted) {
      const timestamp = event.timestamp || 0;
      if (timestamp < day.startDateMs || timestamp >= nextBoundary(day.startDateMs) || !event.categoryId) continue;
      const category = categoriesById.get(String(event.categoryId));
      if (!category) continue;
      dayCategories.set(category._id, dayCategories.get(category._id) || {
        categoryId: category._id, name: category.name, color: category.color, isProductive: category.isProductive, durationMs: 0
      });
    }
    // Populate day category totals from overlap calculations rather than from
    // event starts, so long unchanged activities are represented accurately.
    for (let index = 0; index < sorted.length; index += 1) {
      const event = sorted[index];
      if (event.type === 'system' || !event.categoryId) continue;
      const category = categoriesById.get(String(event.categoryId));
      if (!category) continue;
      const overlapStart = Math.max(event.timestamp || 0, day.startDateMs, startDateMs);
      const overlapEnd = Math.min(sorted[index + 1]?.timestamp ?? nowMs, (event.timestamp || 0) + MAX_CONTINUOUS_ACTIVITY_MS, nextBoundary(day.startDateMs), endDateMs, nowMs);
      if (overlapEnd <= overlapStart) continue;
      const entry = dayCategories.get(category._id) || {
        categoryId: category._id, name: category.name, color: category.color, isProductive: category.isProductive, durationMs: 0
      };
      entry.durationMs += overlapEnd - overlapStart;
      dayCategories.set(category._id, entry);
    }
    day.categoryTotals = [...dayCategories.values()].filter((entry) => entry.durationMs > 0).sort((a, b) => b.durationMs - a.durationMs);
  }

  return {
    days: [...days.values()].sort((a, b) => a.startDateMs - b.startDateMs),
    hours,
    totals,
    categoryTotals: [...periodCategoryTotals.values()].sort((a, b) => b.durationMs - a.durationMs)
  };
};

export const averageMatchingWeekdayByTime = (args: {
  events: ActiveWindowEvent[];
  categories: Category[];
  comparisonAtMs: number;
  sampleLimit?: number;
  nowMs?: number;
}) => {
  const comparison = new Date(args.comparisonAtMs);
  const comparisonStart = dayStart(args.comparisonAtMs);
  const cutoffHours = comparison.getHours();
  const cutoffMinutes = comparison.getMinutes();
  const cutoffSeconds = comparison.getSeconds();
  const samples: number[] = [];
  for (let offset = 7; samples.length < (args.sampleLimit || 4) && offset <= 70; offset += 7) {
    const start = new Date(comparisonStart);
    start.setDate(start.getDate() - offset);
    const end = new Date(start);
    end.setHours(cutoffHours, cutoffMinutes, cutoffSeconds, comparison.getMilliseconds());
    const result = calculatePeriodAnalytics(args.events, args.categories, start.getTime(), end.getTime(), args.nowMs ?? Date.now());
    if (result.totals.trackedMs > 0) samples.push(result.totals.focusedMs);
  }
  return {
    focusedMs: samples.length ? Math.round(samples.reduce((total, value) => total + value, 0) / samples.length) : null,
    sampleCount: samples.length
  };
};

/**
 * Returns a practical "normal day" comparison: the most recent active
 * calendar days, each clipped at the same local clock time as the current
 * day. Unlike a matching-weekday baseline, this remains useful while Tempo is
 * still gathering enough history for a particular weekday.
 */
export const averageActiveDaysByTime = (args: {
  events: ActiveWindowEvent[];
  categories: Category[];
  comparisonAtMs: number;
  sampleLimit?: number;
  nowMs?: number;
}) => {
  const comparison = new Date(args.comparisonAtMs);
  const comparisonStart = dayStart(args.comparisonAtMs);
  const samples: number[] = [];
  for (let offset = 1; samples.length < (args.sampleLimit || 4) && offset <= 70; offset += 1) {
    const start = new Date(comparisonStart);
    start.setDate(start.getDate() - offset);
    const end = new Date(start);
    end.setHours(comparison.getHours(), comparison.getMinutes(), comparison.getSeconds(), comparison.getMilliseconds());
    const result = calculatePeriodAnalytics(args.events, args.categories, start.getTime(), end.getTime(), args.nowMs ?? Date.now());
    if (result.totals.trackedMs > 0) samples.push(result.totals.focusedMs);
  }
  return {
    focusedMs: samples.length ? Math.round(samples.reduce((total, value) => total + value, 0) / samples.length) : null,
    sampleCount: samples.length
  };
};

/**
 * Uses the same bounded, calendar-aware interval calculation as the timeline
 * while limiting a “usual by now” baseline to genuinely comparable days.
 */
export const averageComparableDaysByTime = (args: {
  events: ActiveWindowEvent[];
  categories: Category[];
  comparisonAtMs: number;
  mode: FocusComparisonMode;
  sampleLimit?: number;
  nowMs?: number;
}) => {
  const comparison = new Date(args.comparisonAtMs);
  const comparisonStart = dayStart(args.comparisonAtMs);
  const comparisonWeekday = comparison.getDay();
  const comparisonIsWeekend = comparisonWeekday === 0 || comparisonWeekday === 6;
  const matchesComparison = (candidate: Date) => {
    if (args.mode === 'all_active_days') return true;
    if (args.mode === 'same_weekday') return candidate.getDay() === comparisonWeekday;
    const candidateWeekday = candidate.getDay();
    return (candidateWeekday === 0 || candidateWeekday === 6) === comparisonIsWeekend;
  };
  const samples: number[] = [];
  for (let offset = 1; samples.length < (args.sampleLimit || 4) && offset <= 70; offset += 1) {
    const start = new Date(comparisonStart);
    start.setDate(start.getDate() - offset);
    if (!matchesComparison(start)) continue;
    const end = new Date(start);
    end.setHours(comparison.getHours(), comparison.getMinutes(), comparison.getSeconds(), comparison.getMilliseconds());
    const result = calculatePeriodAnalytics(args.events, args.categories, start.getTime(), end.getTime(), args.nowMs ?? Date.now());
    if (result.totals.trackedMs > 0) samples.push(result.totals.focusedMs);
  }
  return {
    focusedMs: samples.length ? Math.round(samples.reduce((total, value) => total + value, 0) / samples.length) : null,
    sampleCount: samples.length
  };
};
