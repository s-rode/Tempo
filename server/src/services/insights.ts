import type { ActiveWindowEvent, Category } from '../../../shared/types';

/**
 * Behavioural insights for the Analysis page.
 *
 * Everything here is derived from the same bounded activity intervals the
 * timeline uses (an event lasts until the next event, a system boundary, a
 * four-hour ceiling, the range end or now). On top of those intervals the
 * module finds focus blocks, distraction detours, the hours that work best
 * and how focus sessions really went, then turns the strongest patterns into
 * a few concrete suggestions. It is pure so it can be tested without Mongo.
 */

type State = 'focused' | 'distracted' | 'uncertain';

export interface InsightInterval {
  startMs: number;
  endMs: number;
  state: State;
  sourceKey: string;
  sourceLabel: string;
  activityLabel: string | null;
}

export interface InsightRunPhase {
  kind: 'work' | 'short_break' | 'long_break';
  goal?: string | null;
  startedAtMs?: number | null;
  completedAtMs?: number | null;
  plannedDurationMs?: number;
  activeElapsedMs?: number;
}

export interface InsightRun {
  run: {
    id: string;
    kind: 'custom' | 'pomodoro';
    startedAtMs: number;
    phases: InsightRunPhase[];
    taskTarget?: { goalSnapshot?: string | null; estimatedMinutes?: number | null } | null;
  };
  endedAtMs: number | null;
  outcome: 'completed' | 'cancelled' | null;
}

export interface FocusBlock {
  startMs: number;
  endMs: number;
  focusedMs: number;
  endedBy: 'drift' | 'unclassified' | 'pause';
}

export interface DistractionEpisode {
  startMs: number;
  endMs: number;
  durationMs: number;
  sourceKey: string;
  returnedToFocus: boolean;
  gatewayKey: string | null;
}

export interface InsightSuggestion {
  id: string;
  kind: 'schedule' | 'session' | 'distraction' | 'switching' | 'planning' | 'momentum';
  title: string;
  body: string;
}

export interface PeriodSummary {
  focusedMs: number;
  distractedMs: number;
  uncertainMs: number;
  trackedMs: number;
  focusRate: number | null;
  deepWorkMs: number;
  deepBlocks: number;
  longestBlockMs: number;
  appSwitches: number;
  activeDays: number;
}

export interface PeriodInsights {
  range: { startDateMs: number; endDateMs: number; effectiveEndMs: number };
  previousRange: { startDateMs: number; endDateMs: number };
  summary: PeriodSummary;
  previous: PeriodSummary;
  days: Array<{
    startDateMs: number;
    focusedMs: number;
    distractedMs: number;
    uncertainMs: number;
    deepWorkMs: number;
    longestBlockMs: number;
    appSwitches: number;
  }>;
  /** [weekday Monday=0][hour] totals plus how many calendar days of each weekday the range covers. */
  heatmap: { focusedMs: number[][]; distractedMs: number[][]; weekdayDays: number[] };
  hours: Array<{ hour: number; focusedMs: number; distractedMs: number }>;
  goldenWindow: { startHour: number; endHour: number; focusedMs: number; focusRate: number; shareOfFocus: number } | null;
  driftHour: { hour: number; distractedMs: number; distractionShare: number } | null;
  stamina: {
    medianBlockMs: number | null;
    sampleCount: number;
    /** Focus blocks of at least five minutes, bucketed by length. */
    buckets: Array<{ label: string; minMs: number; maxMs: number | null; count: number; focusedMs: number }>;
  };
  distractions: {
    episodes: number;
    medianDetourMs: number | null;
    longDetours: number;
    longDetourMs: number;
    returnRate: number | null;
    sources: Array<{ key: string; label: string; distractedMs: number; episodes: number; examples: string[] }>;
    gateways: Array<{ key: string; label: string; episodes: number }>;
  };
  switching: {
    perTrackedHour: number | null;
    previousPerTrackedHour: number | null;
    calmerDays: { days: number; focusRate: number } | null;
    busierDays: { days: number; focusRate: number } | null;
  };
  sessions: {
    count: number;
    completed: number;
    cancelled: number;
    focusRate: number | null;
    medianFirstDriftMs: number | null;
    byLength: Array<{ label: string; count: number; focusRate: number | null }>;
    estimate: { samples: number; medianRatio: number } | null;
    tasks: Array<{ goal: string; sessions: number; workMs: number; focusedMs: number; focusRate: number | null }>;
  };
  suggestions: InsightSuggestion[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MAX_CONTINUOUS_ACTIVITY_MS = 4 * HOUR;
/** A glance away shorter than this does not break a focus block. */
export const BLOCK_INTERRUPTION_TOLERANCE_MS = 2 * MINUTE;
export const DEEP_BLOCK_MS = 25 * MINUTE;
const MIN_STRETCH_MS = 5 * MINUTE;
const LONG_DETOUR_MS = 10 * MINUTE;
/** Pauses inside a phase are not on the clock; allow a little slack for them. */
const SESSION_SLACK_MS = 5 * MINUTE;
/** Generic fallback labels add nothing as an example of a distraction. */
const GENERIC_LABEL = /^(distracted by|focused on|working on)\b/i;
const SYSTEM_EVENT_NAMES = new Set(['System Sleep', 'System Wake', 'System Lock', 'System Unlock']);

const PAGE_KIND_LABELS: Record<string, string> = {
  problem_solving: 'Problem solving',
  learning: 'Learning',
  reference: 'Reference',
  note_taking: 'Notes',
  coding: 'Coding',
  writing: 'Writing',
  communication: 'Messaging',
  administration: 'Admin',
  social: 'Social media',
  entertainment: 'Entertainment',
  shopping: 'Shopping',
  general_browsing: 'Browsing',
};

const isBrowserEvent = (event: ActiveWindowEvent) => event.type === 'browser' || !!event.browser;

export const sourceFor = (event: ActiveWindowEvent) => {
  if (!isBrowserEvent(event)) return { key: `app:${event.ownerName}`, label: event.ownerName };
  const kind = event.pageKind && PAGE_KIND_LABELS[event.pageKind] ? event.pageKind : 'web';
  const kindLabel = kind === 'web' ? 'Websites' : PAGE_KIND_LABELS[kind];
  return { key: `web:${event.ownerName}:${kind}`, label: `${kindLabel} in ${event.ownerName}` };
};

const dayStart = (value: number) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};
const nextDay = (value: number) => {
  const date = new Date(value);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
};
const nextHour = (value: number) => {
  const date = new Date(value);
  date.setMinutes(60, 0, 0);
  return date.getTime();
};
const weekdayIndex = (value: number) => (new Date(value).getDay() + 6) % 7;

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const rate = (focusedMs: number, distractedMs: number) =>
  focusedMs + distractedMs > 0 ? focusedMs / (focusedMs + distractedMs) : null;

/** Sorted, bounded activity intervals inside [startMs, endMs). */
export const buildIntervals = (
  events: ActiveWindowEvent[],
  categories: Category[],
  startMs: number,
  endMs: number,
  nowMs: number
): InsightInterval[] => {
  const categoriesById = new Map(categories.map((category) => [String(category._id), category]));
  const sorted = [...events].sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0));
  const intervals: InsightInterval[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const event = sorted[index];
    const timestamp = event.timestamp || 0;
    if (timestamp >= endMs || timestamp >= nowMs) break;
    if (event.type === 'system' || SYSTEM_EVENT_NAMES.has(event.ownerName)) continue;
    const nextTimestamp = sorted[index + 1]?.timestamp;
    const intervalEnd = Math.min(nextTimestamp ?? nowMs, timestamp + MAX_CONTINUOUS_ACTIVITY_MS, endMs, nowMs);
    const intervalStart = Math.max(timestamp, startMs);
    if (intervalEnd <= intervalStart) continue;
    const category = event.categoryId ? categoriesById.get(String(event.categoryId)) : undefined;
    const state: State = category?.isProductive === true ? 'focused' : category?.isProductive === false ? 'distracted' : 'uncertain';
    const source = sourceFor(event);
    intervals.push({
      startMs: intervalStart,
      endMs: intervalEnd,
      state,
      sourceKey: source.key,
      sourceLabel: source.label,
      activityLabel: event.activityLabel || null,
    });
  }
  return intervals;
};

/**
 * Focus blocks: stretches of focused activity that survive short glances
 * away (up to two minutes in a row). Interruption time never counts as focus.
 */
export const findFocusBlocks = (intervals: InsightInterval[]): FocusBlock[] => {
  const blocks: FocusBlock[] = [];
  let current: { startMs: number; lastFocusEndMs: number; focusedMs: number } | null = null;
  let pendingMs = 0;
  let previousEndMs: number | null = null;
  const close = (endedBy: FocusBlock['endedBy']) => {
    if (current) blocks.push({ startMs: current.startMs, endMs: current.lastFocusEndMs, focusedMs: current.focusedMs, endedBy });
    current = null;
    pendingMs = 0;
  };
  for (const interval of intervals) {
    if (current && previousEndMs !== null && interval.startMs - previousEndMs > 0) {
      // Sleep, lock or the four-hour ceiling: idle time is a pause, and a
      // pause longer than the tolerance ends the block.
      pendingMs += interval.startMs - previousEndMs;
      if (pendingMs > BLOCK_INTERRUPTION_TOLERANCE_MS) close('pause');
    }
    previousEndMs = interval.endMs;
    const durationMs = interval.endMs - interval.startMs;
    if (interval.state === 'focused') {
      if (!current) current = { startMs: interval.startMs, lastFocusEndMs: interval.endMs, focusedMs: 0 };
      current.focusedMs += durationMs;
      current.lastFocusEndMs = interval.endMs;
      pendingMs = 0;
      continue;
    }
    if (!current) continue;
    pendingMs += durationMs;
    if (pendingMs > BLOCK_INTERRUPTION_TOLERANCE_MS) close(interval.state === 'distracted' ? 'drift' : 'unclassified');
  }
  close('pause');
  return blocks;
};

/** Contiguous runs of distracted activity, with what came right before. */
export const findDistractionEpisodes = (intervals: InsightInterval[]): DistractionEpisode[] => {
  const episodes: DistractionEpisode[] = [];
  let index = 0;
  while (index < intervals.length) {
    const interval = intervals[index];
    if (interval.state !== 'distracted') {
      index += 1;
      continue;
    }
    const before = intervals[index - 1];
    const gatewayKey = before && before.endMs === interval.startMs && before.state !== 'distracted' ? before.sourceKey : null;
    const sourceTotals = new Map<string, number>();
    const startMs = interval.startMs;
    let endMs = interval.endMs;
    while (index < intervals.length && intervals[index].state === 'distracted' && intervals[index].startMs <= endMs) {
      const part = intervals[index];
      sourceTotals.set(part.sourceKey, (sourceTotals.get(part.sourceKey) || 0) + part.endMs - part.startMs);
      endMs = part.endMs;
      index += 1;
    }
    const after = intervals[index];
    const sourceKey = [...sourceTotals.entries()].sort((a, b) => b[1] - a[1])[0][0];
    episodes.push({
      startMs,
      endMs,
      durationMs: endMs - startMs,
      sourceKey,
      returnedToFocus: !!after && after.state === 'focused' && after.startMs === endMs,
      gatewayKey,
    });
  }
  return episodes;
};

const clipped = (intervals: InsightInterval[], startMs: number, endMs: number) =>
  intervals.flatMap((interval) => {
    const s = Math.max(interval.startMs, startMs);
    const e = Math.min(interval.endMs, endMs);
    return e > s ? [{ ...interval, startMs: s, endMs: e }] : [];
  });

const countSwitches = (events: ActiveWindowEvent[], startMs: number, endMs: number) => {
  const perDay = new Map<number, number>();
  let previousApp: string | null = null;
  let total = 0;
  const sorted = [...events].sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0));
  for (const event of sorted) {
    const timestamp = event.timestamp || 0;
    if (timestamp >= endMs) break;
    if (event.type === 'system' || SYSTEM_EVENT_NAMES.has(event.ownerName)) {
      previousApp = null;
      continue;
    }
    if (timestamp >= startMs && previousApp && previousApp !== event.ownerName) {
      total += 1;
      const key = dayStart(timestamp);
      perDay.set(key, (perDay.get(key) || 0) + 1);
    }
    previousApp = event.ownerName;
  }
  return { total, perDay };
};

const summarize = (
  intervals: InsightInterval[],
  blocks: FocusBlock[],
  switches: number
): PeriodSummary => {
  const totals = { focusedMs: 0, distractedMs: 0, uncertainMs: 0 };
  const activeDays = new Set<number>();
  for (const interval of intervals) {
    totals[`${interval.state}Ms` as const] += interval.endMs - interval.startMs;
    activeDays.add(dayStart(interval.startMs));
  }
  const deep = blocks.filter((block) => block.focusedMs >= DEEP_BLOCK_MS);
  return {
    ...totals,
    trackedMs: totals.focusedMs + totals.distractedMs + totals.uncertainMs,
    focusRate: rate(totals.focusedMs, totals.distractedMs),
    deepWorkMs: deep.reduce((sum, block) => sum + block.focusedMs, 0),
    deepBlocks: deep.length,
    longestBlockMs: Math.max(0, ...blocks.map((block) => block.focusedMs)),
    appSwitches: switches,
    activeDays: activeDays.size,
  };
};

const formatMinutes = (ms: number) => {
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};
const formatHour = (hour: number) => `${String(hour % 24).padStart(2, '0')}:00`;
const percent = (value: number) => `${Math.round(value * 100)}%`;
const roundTo5 = (minutes: number) => Math.max(15, Math.min(90, Math.round(minutes / 5) * 5));

const SESSION_LENGTHS = [
  { label: 'Up to 25 min', max: 25 * MINUTE },
  { label: '26–45 min', max: 45 * MINUTE },
  { label: '46–75 min', max: 75 * MINUTE },
  { label: 'Over 75 min', max: Infinity },
];
const STAMINA_BUCKETS = [
  { label: '5–15 min', minMs: 5 * MINUTE, maxMs: 15 * MINUTE },
  { label: '15–25 min', minMs: 15 * MINUTE, maxMs: 25 * MINUTE },
  { label: '25–50 min', minMs: 25 * MINUTE, maxMs: 50 * MINUTE },
  { label: '50–90 min', minMs: 50 * MINUTE, maxMs: 90 * MINUTE },
  { label: '90+ min', minMs: 90 * MINUTE, maxMs: null },
];

export const calculatePeriodInsights = (args: {
  events: ActiveWindowEvent[];
  categories: Category[];
  runs: InsightRun[];
  startDateMs: number;
  endDateMs: number;
  previousStartDateMs: number;
  nowMs?: number;
}): PeriodInsights => {
  const nowMs = args.nowMs ?? Date.now();
  const { startDateMs, endDateMs, previousStartDateMs } = args;
  const effectiveEndMs = Math.max(startDateMs, Math.min(endDateMs, nowMs));
  // Compare like with like: a week in progress is measured against the same
  // elapsed stretch of the previous period, not against a whole one.
  const previousEndMs = Math.min(startDateMs, previousStartDateMs + (effectiveEndMs - startDateMs));
  const categories = args.categories.map((category) => ({ ...category, _id: String(category._id) }));

  const intervals = buildIntervals(args.events, categories, startDateMs, endDateMs, nowMs);
  const blocks = findFocusBlocks(intervals);
  const episodes = findDistractionEpisodes(intervals);
  const switches = countSwitches(args.events, startDateMs, effectiveEndMs);
  const summary = summarize(intervals, blocks, switches.total);

  const previousIntervals = buildIntervals(args.events, categories, previousStartDateMs, previousEndMs, nowMs);
  const previous = summarize(
    previousIntervals,
    findFocusBlocks(previousIntervals),
    countSwitches(args.events, previousStartDateMs, previousEndMs).total
  );

  // Days, heatmap and hours.
  const dayMap = new Map<number, PeriodInsights['days'][number]>();
  const weekdayDays = Array(7).fill(0);
  for (let cursor = startDateMs; cursor < endDateMs; cursor = nextDay(cursor)) {
    const key = dayStart(cursor);
    dayMap.set(key, { startDateMs: key, focusedMs: 0, distractedMs: 0, uncertainMs: 0, deepWorkMs: 0, longestBlockMs: 0, appSwitches: switches.perDay.get(key) || 0 });
    if (key < effectiveEndMs) weekdayDays[weekdayIndex(key)] += 1;
  }
  const heatFocus = Array.from({ length: 7 }, () => Array(24).fill(0));
  const heatDistract = Array.from({ length: 7 }, () => Array(24).fill(0));
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, focusedMs: 0, distractedMs: 0 }));
  for (const interval of intervals) {
    let cursor = interval.startMs;
    while (cursor < interval.endMs) {
      const sliceEnd = Math.min(interval.endMs, nextHour(cursor), nextDay(cursor));
      const ms = sliceEnd - cursor;
      const day = dayMap.get(dayStart(cursor));
      if (day) day[`${interval.state}Ms` as const] += ms;
      const hour = new Date(cursor).getHours();
      if (interval.state === 'focused') {
        heatFocus[weekdayIndex(cursor)][hour] += ms;
        hours[hour].focusedMs += ms;
      } else if (interval.state === 'distracted') {
        heatDistract[weekdayIndex(cursor)][hour] += ms;
        hours[hour].distractedMs += ms;
      }
      cursor = sliceEnd;
    }
  }
  for (const block of blocks) {
    const day = dayMap.get(dayStart(block.startMs));
    if (!day) continue;
    if (block.focusedMs >= DEEP_BLOCK_MS) day.deepWorkMs += block.focusedMs;
    day.longestBlockMs = Math.max(day.longestBlockMs, block.focusedMs);
  }

  // The best two consecutive hours by focused time, and the weakest hour.
  let goldenWindow: PeriodInsights['goldenWindow'] = null;
  for (let hour = 0; hour < 23; hour += 1) {
    const focusedMs = hours[hour].focusedMs + hours[hour + 1].focusedMs;
    const distractedMs = hours[hour].distractedMs + hours[hour + 1].distractedMs;
    if (focusedMs < 30 * MINUTE) continue;
    if (!goldenWindow || focusedMs > goldenWindow.focusedMs) {
      goldenWindow = {
        startHour: hour,
        endHour: hour + 2,
        focusedMs,
        focusRate: rate(focusedMs, distractedMs) ?? 0,
        shareOfFocus: summary.focusedMs ? focusedMs / summary.focusedMs : 0,
      };
    }
  }
  let driftHour: PeriodInsights['driftHour'] = null;
  for (const entry of hours) {
    const share = 1 - (rate(entry.focusedMs, entry.distractedMs) ?? 1);
    if (entry.distractedMs < 15 * MINUTE) continue;
    if (!driftHour || entry.distractedMs > driftHour.distractedMs) {
      driftHour = { hour: entry.hour, distractedMs: entry.distractedMs, distractionShare: share };
    }
  }

  // Stamina: how long focus usually holds before the first real drift.
  const stretches = blocks.filter((block) => block.focusedMs >= MIN_STRETCH_MS);
  const drifted = stretches.filter((block) => block.endedBy === 'drift');
  const staminaSample = drifted.length >= 3 ? drifted : stretches;
  const stamina: PeriodInsights['stamina'] = {
    medianBlockMs: staminaSample.length >= 3 ? median(staminaSample.map((block) => block.focusedMs)) : null,
    sampleCount: staminaSample.length,
    buckets: STAMINA_BUCKETS.map((bucket) => {
      const matching = stretches.filter((block) => block.focusedMs >= bucket.minMs && (bucket.maxMs === null || block.focusedMs < bucket.maxMs));
      return { ...bucket, count: matching.length, focusedMs: matching.reduce((sum, block) => sum + block.focusedMs, 0) };
    }),
  };

  // Distraction anatomy.
  const labels = new Map<string, string>();
  const examples = new Map<string, Map<string, number>>();
  const sourceTotals = new Map<string, number>();
  for (const interval of intervals) {
    labels.set(interval.sourceKey, interval.sourceLabel);
    if (interval.state !== 'distracted') continue;
    const ms = interval.endMs - interval.startMs;
    sourceTotals.set(interval.sourceKey, (sourceTotals.get(interval.sourceKey) || 0) + ms);
    if (interval.activityLabel && interval.sourceKey.startsWith('web:') && !GENERIC_LABEL.test(interval.activityLabel.trim())) {
      const perSource = examples.get(interval.sourceKey) || new Map<string, number>();
      perSource.set(interval.activityLabel, (perSource.get(interval.activityLabel) || 0) + ms);
      examples.set(interval.sourceKey, perSource);
    }
  }
  const episodeCounts = new Map<string, number>();
  const gatewayCounts = new Map<string, number>();
  for (const episode of episodes) {
    episodeCounts.set(episode.sourceKey, (episodeCounts.get(episode.sourceKey) || 0) + 1);
    if (episode.gatewayKey) gatewayCounts.set(episode.gatewayKey, (gatewayCounts.get(episode.gatewayKey) || 0) + 1);
  }
  const longDetours = episodes.filter((episode) => episode.durationMs >= LONG_DETOUR_MS);
  const distractions: PeriodInsights['distractions'] = {
    episodes: episodes.length,
    medianDetourMs: median(episodes.map((episode) => episode.durationMs)),
    longDetours: longDetours.length,
    longDetourMs: longDetours.reduce((sum, episode) => sum + episode.durationMs, 0),
    returnRate: episodes.length ? episodes.filter((episode) => episode.returnedToFocus).length / episodes.length : null,
    sources: [...sourceTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([key, distractedMs]) => ({
        key,
        label: labels.get(key) || key,
        distractedMs,
        episodes: episodeCounts.get(key) || 0,
        examples: [...(examples.get(key)?.entries() || [])].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([label]) => label),
      })),
    gateways: [...gatewayCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key, count]) => ({ key, label: labels.get(key) || key, episodes: count })),
  };

  // Context switching versus focus, day by day.
  const switchDays = [...dayMap.values()]
    .filter((day) => day.focusedMs + day.distractedMs + day.uncertainMs >= 30 * MINUTE)
    .map((day) => ({
      perHour: day.appSwitches / ((day.focusedMs + day.distractedMs + day.uncertainMs) / HOUR),
      focusedMs: day.focusedMs,
      distractedMs: day.distractedMs,
    }))
    .sort((a, b) => a.perHour - b.perHour);
  const half = (rows: typeof switchDays) => {
    const focusedMs = rows.reduce((sum, row) => sum + row.focusedMs, 0);
    const distractedMs = rows.reduce((sum, row) => sum + row.distractedMs, 0);
    return { days: rows.length, focusRate: rate(focusedMs, distractedMs) ?? 0 };
  };
  const calmCount = Math.floor(switchDays.length / 2);
  const switching: PeriodInsights['switching'] = {
    perTrackedHour: summary.trackedMs >= 30 * MINUTE ? summary.appSwitches / (summary.trackedMs / HOUR) : null,
    previousPerTrackedHour: previous.trackedMs >= 30 * MINUTE ? previous.appSwitches / (previous.trackedMs / HOUR) : null,
    calmerDays: switchDays.length >= 4 ? half(switchDays.slice(0, calmCount)) : null,
    busierDays: switchDays.length >= 4 ? half(switchDays.slice(switchDays.length - calmCount)) : null,
  };

  // Focus sessions, measured by the classified activity inside them.
  const sessionRows = args.runs
    .filter((entry) => entry.run.startedAtMs >= startDateMs && entry.run.startedAtMs < endDateMs)
    .map((entry) => {
      const phases = entry.run.phases;
      const work = phases.filter((phase) => phase.kind === 'work' && phase.startedAtMs);
      let focusedMs = 0;
      let distractedMs = 0;
      const firstDrifts: number[] = [];
      let coveredUntilMs = -Infinity;
      for (const phase of work) {
        // A phase's wall-clock span can include pauses, and archived phases
        // do not always carry a completion time. Bound the window by the
        // next phase, the run's end and the time actually on the clock (plus
        // a little slack), and never count the same moment twice.
        const index = phases.indexOf(phase);
        const nextStart = phases.slice(index + 1).find((candidate) => candidate.startedAtMs)?.startedAtMs ?? Infinity;
        const phaseStart = Math.max(phase.startedAtMs as number, coveredUntilMs);
        const clockEnd = (phase.startedAtMs as number) + Math.max(phase.activeElapsedMs || 0, MINUTE) + SESSION_SLACK_MS;
        const phaseEnd = Math.min(phase.completedAtMs ?? Infinity, nextStart, entry.endedAtMs ?? effectiveEndMs, clockEnd, effectiveEndMs);
        if (phaseEnd <= phaseStart) continue;
        coveredUntilMs = phaseEnd;
        const inside = clipped(intervals, phaseStart, phaseEnd);
        let focusBeforeDrift = 0;
        let drifted = false;
        for (const interval of inside) {
          const ms = interval.endMs - interval.startMs;
          if (interval.state === 'focused') {
            focusedMs += ms;
            if (!drifted) focusBeforeDrift += ms;
          }
          if (interval.state === 'distracted') {
            distractedMs += ms;
            if (!drifted && ms >= MINUTE) {
              drifted = true;
              firstDrifts.push(focusBeforeDrift);
            }
          }
        }
      }
      const goal = (entry.run.taskTarget?.goalSnapshot || work.find((phase) => phase.goal)?.goal || '').trim();
      return {
        outcome: entry.outcome,
        goal,
        plannedMs: work.reduce((sum, phase) => sum + (phase.plannedDurationMs || 0), 0) / Math.max(1, work.length),
        workMs: work.reduce((sum, phase) => sum + (phase.activeElapsedMs || 0), 0),
        estimatedMs: entry.run.taskTarget?.estimatedMinutes ? entry.run.taskTarget.estimatedMinutes * MINUTE : null,
        focusedMs,
        distractedMs,
        firstDrifts,
      };
    })
    .filter((row) => row.workMs >= MINUTE || row.focusedMs + row.distractedMs >= MINUTE);
  const sessionFocused = sessionRows.reduce((sum, row) => sum + row.focusedMs, 0);
  const sessionDistracted = sessionRows.reduce((sum, row) => sum + row.distractedMs, 0);
  const estimateRatios = sessionRows
    .filter((row) => row.outcome === 'completed' && row.estimatedMs && row.workMs >= 5 * MINUTE)
    .map((row) => row.workMs / (row.estimatedMs as number));
  const taskMap = new Map<string, { goal: string; sessions: number; workMs: number; focusedMs: number; distractedMs: number }>();
  for (const row of sessionRows) {
    if (!row.goal) continue;
    const key = row.goal.toLowerCase();
    const entry = taskMap.get(key) || { goal: row.goal, sessions: 0, workMs: 0, focusedMs: 0, distractedMs: 0 };
    entry.sessions += 1;
    entry.workMs += row.workMs;
    entry.focusedMs += row.focusedMs;
    entry.distractedMs += row.distractedMs;
    taskMap.set(key, entry);
  }
  let lowerBound = 0;
  const sessions: PeriodInsights['sessions'] = {
    count: sessionRows.length,
    completed: sessionRows.filter((row) => row.outcome === 'completed').length,
    cancelled: sessionRows.filter((row) => row.outcome === 'cancelled').length,
    focusRate: rate(sessionFocused, sessionDistracted),
    medianFirstDriftMs: median(sessionRows.flatMap((row) => row.firstDrifts)),
    byLength: SESSION_LENGTHS.map((bucket) => {
      const min = lowerBound;
      lowerBound = bucket.max;
      const rows = sessionRows.filter((row) => row.plannedMs > min && row.plannedMs <= bucket.max);
      return {
        label: bucket.label,
        count: rows.length,
        focusRate: rate(rows.reduce((sum, row) => sum + row.focusedMs, 0), rows.reduce((sum, row) => sum + row.distractedMs, 0)),
      };
    }),
    estimate: estimateRatios.length >= 2 ? { samples: estimateRatios.length, medianRatio: median(estimateRatios) as number } : null,
    tasks: [...taskMap.values()]
      .sort((a, b) => b.focusedMs - a.focusedMs)
      .slice(0, 5)
      .map((task) => ({ goal: task.goal, sessions: task.sessions, workMs: task.workMs, focusedMs: task.focusedMs, focusRate: rate(task.focusedMs, task.distractedMs) })),
  };

  const insights: Omit<PeriodInsights, 'suggestions'> = {
    range: { startDateMs, endDateMs, effectiveEndMs },
    previousRange: { startDateMs: previousStartDateMs, endDateMs: previousEndMs },
    summary,
    previous,
    days: [...dayMap.values()].sort((a, b) => a.startDateMs - b.startDateMs),
    heatmap: { focusedMs: heatFocus, distractedMs: heatDistract, weekdayDays },
    hours,
    goldenWindow,
    driftHour,
    stamina,
    distractions,
    switching,
    sessions,
  };
  return { ...insights, suggestions: buildSuggestions(insights) };
};

/**
 * Turns the strongest patterns into at most three suggestions. Each rule
 * needs enough evidence before it speaks, so a quiet week says little
 * rather than something made up.
 */
export const buildSuggestions = (insights: Omit<PeriodInsights, 'suggestions'>): InsightSuggestion[] => {
  const candidates: Array<InsightSuggestion & { weight: number }> = [];
  const { summary, goldenWindow, driftHour, stamina, distractions, switching, sessions, previous } = insights;
  const overallRate = summary.focusRate ?? 0;

  if (goldenWindow && goldenWindow.focusedMs >= HOUR && goldenWindow.shareOfFocus >= 0.2) {
    candidates.push({
      id: 'golden-window',
      kind: 'schedule',
      title: `Protect ${formatHour(goldenWindow.startHour)}–${formatHour(goldenWindow.endHour)} for your hardest work`,
      body: `${percent(goldenWindow.shareOfFocus)} of your focused time happened in these two hours, at a ${percent(goldenWindow.focusRate)} focus rate. Keep meetings and messages out of this window.`,
      weight: 60 + goldenWindow.shareOfFocus * 40,
    });
  }

  const bestLength = sessions.byLength
    .filter((bucket) => bucket.count >= 2 && bucket.focusRate !== null)
    .sort((a, b) => (b.focusRate as number) - (a.focusRate as number));
  if (bestLength.length >= 2 && (bestLength[0].focusRate as number) - (bestLength[bestLength.length - 1].focusRate as number) >= 0.1) {
    const best = bestLength[0];
    const worst = bestLength[bestLength.length - 1];
    candidates.push({
      id: 'session-length',
      kind: 'session',
      title: `Plan sessions of ${best.label.toLowerCase()}`,
      body: `Those sessions ran at ${percent(best.focusRate as number)} focus, compared with ${percent(worst.focusRate as number)} for ${worst.label.toLowerCase()}.`,
      weight: 70,
    });
  } else if (stamina.medianBlockMs !== null && stamina.sampleCount >= 4) {
    const suggested = roundTo5(stamina.medianBlockMs / MINUTE);
    candidates.push({
      id: 'stamina',
      kind: 'session',
      title: `Try ${suggested}-minute sessions with a short break after`,
      body: `Your focus usually holds for about ${formatMinutes(stamina.medianBlockMs)} before you drift. Ending a session there, and taking a break, beats losing the last part of it.`,
      weight: 55,
    });
  }

  const topSource = distractions.sources[0];
  const distractedTotal = summary.distractedMs;
  if (topSource && topSource.distractedMs >= 20 * MINUTE && distractedTotal > 0 && topSource.distractedMs / distractedTotal >= 0.3) {
    const share = topSource.distractedMs / distractedTotal;
    const example = topSource.examples[0] ? ` (mostly ${topSource.examples[0]})` : '';
    candidates.push({
      id: 'top-source',
      kind: 'distraction',
      title: `${topSource.label} is your biggest leak`,
      body: `It took ${formatMinutes(topSource.distractedMs)}${example}, ${percent(share)} of all distracted time, over ${topSource.episodes} detour${topSource.episodes === 1 ? '' : 's'}. Close it before a session starts, or make Tempo stricter about it.`,
      weight: 50 + share * 40,
    });
  }

  if (distractions.longDetours >= 2 && distractedTotal > 0 && distractions.longDetourMs / distractedTotal >= 0.5) {
    candidates.push({
      id: 'rabbit-holes',
      kind: 'distraction',
      title: 'A few long detours cost the most',
      body: `${distractions.longDetours} detours of 10 minutes or more made up ${percent(distractions.longDetourMs / distractedTotal)} of your distracted time. The first two minutes are when coming back is easiest, so act on the first nudge.`,
      weight: 58,
    });
  }

  const gateway = distractions.gateways[0];
  if (gateway && distractions.episodes >= 5 && gateway.episodes / distractions.episodes >= 0.3) {
    candidates.push({
      id: 'gateway',
      kind: 'distraction',
      title: `Drifts often start right after ${gateway.label}`,
      body: `${gateway.episodes} of ${distractions.episodes} detours began straight after using it. Check it at set times instead of in the middle of a task.`,
      weight: 52,
    });
  }

  if (switching.calmerDays && switching.busierDays && switching.calmerDays.focusRate - switching.busierDays.focusRate >= 0.1) {
    candidates.push({
      id: 'switching',
      kind: 'switching',
      title: 'Fewer app switches, better days',
      body: `On your calmer days you focused ${percent(switching.calmerDays.focusRate)} of the time, on the busiest ${percent(switching.busierDays.focusRate)}. Keep one app in front per task and batch the rest.`,
      weight: 45 + (switching.calmerDays.focusRate - switching.busierDays.focusRate) * 100,
    });
  }

  if (sessions.estimate && sessions.estimate.samples >= 3 && (sessions.estimate.medianRatio >= 1.25 || sessions.estimate.medianRatio <= 0.75)) {
    const over = sessions.estimate.medianRatio >= 1.25;
    candidates.push({
      id: 'estimates',
      kind: 'planning',
      title: over
        ? `Tasks take about ${sessions.estimate.medianRatio.toFixed(1)}× your estimate`
        : `You finish tasks faster than you estimate`,
      body: over
        ? `Across ${sessions.estimate.samples} finished tasks. Pad new estimates by that factor so your plan for the day stays realistic.`
        : `Across ${sessions.estimate.samples} finished tasks they took about ${percent(sessions.estimate.medianRatio)} of the planned time. You can plan a little more into a day.`,
      weight: 48,
    });
  }

  if (sessions.count >= 4 && sessions.cancelled / sessions.count >= 0.4) {
    candidates.push({
      id: 'abandoned',
      kind: 'session',
      title: 'Many sessions end early',
      body: `${sessions.cancelled} of ${sessions.count} sessions were stopped before the end. Shorter sessions, or one small first step written into the goal, make them easier to finish.`,
      weight: 50,
    });
  }

  if (driftHour && driftHour.distractionShare >= 0.45 && driftHour.distractedMs >= 30 * MINUTE) {
    candidates.push({
      id: 'drift-hour',
      kind: 'schedule',
      title: `${formatHour(driftHour.hour)} is your weakest hour`,
      body: `${percent(driftHour.distractionShare)} of that hour went to distractions. Put a break, a walk or lighter tasks there instead of deep work.`,
      weight: 46,
    });
  }

  if (previous.deepWorkMs >= HOUR && summary.deepWorkMs < previous.deepWorkMs * 0.7) {
    candidates.push({
      id: 'deep-work-down',
      kind: 'momentum',
      title: 'Deep work dropped compared with last time',
      body: `${formatMinutes(summary.deepWorkMs)} in blocks of 25 minutes or more, down from ${formatMinutes(previous.deepWorkMs)}. Book one uninterrupted block in your calendar for tomorrow.`,
      weight: 44,
    });
  } else if (summary.deepWorkMs >= HOUR && previous.deepWorkMs > 0 && summary.deepWorkMs >= previous.deepWorkMs * 1.2) {
    candidates.push({
      id: 'deep-work-up',
      kind: 'momentum',
      title: 'Deep work is growing',
      body: `${formatMinutes(summary.deepWorkMs)} in long blocks, up from ${formatMinutes(previous.deepWorkMs)}. Whatever changed, keep it.`,
      weight: 30,
    });
  }

  if (!candidates.length && summary.trackedMs >= HOUR && overallRate >= 0.8) {
    candidates.push({
      id: 'steady',
      kind: 'momentum',
      title: 'A steady, focused stretch',
      body: `${percent(overallRate)} of your classified time was focused. Nothing stands out to fix.`,
      weight: 1,
    });
  }

  return candidates
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map(({ weight: _weight, ...suggestion }) => suggestion);
};
