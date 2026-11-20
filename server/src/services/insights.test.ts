import { describe, expect, test } from 'bun:test';
import type { ActiveWindowEvent, Category } from '../../../shared/types';
import { buildIntervals, calculatePeriodInsights, findDistractionEpisodes, findFocusBlocks, type InsightRun } from './insights';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const monday = new Date(2026, 8, 7, 0, 0, 0, 0).getTime();
const previousMonday = monday - 7 * day;
const categories: Category[] = [
  { _id: 'work', userId: 'u', name: 'Work', color: '#22c55e', isProductive: true, createdAt: new Date(), updatedAt: new Date() },
  { _id: 'fun', userId: 'u', name: 'Fun', color: '#f43f5e', isProductive: false, createdAt: new Date(), updatedAt: new Date() },
];
const work = (timestamp: number, ownerName = 'Xcode'): ActiveWindowEvent => ({ userId: 'u', ownerName, title: ownerName, type: 'window', timestamp, categoryId: 'work' });
const fun = (timestamp: number, extra: Partial<ActiveWindowEvent> = {}): ActiveWindowEvent => ({
  userId: 'u',
  ownerName: 'Firefox',
  title: 'Firefox',
  type: 'browser',
  browser: 'firefox',
  pageKind: 'entertainment',
  activityLabel: 'YouTube video',
  timestamp,
  categoryId: 'fun',
  ...extra,
});
const sleep = (timestamp: number): ActiveWindowEvent => ({ userId: 'u', ownerName: 'System Sleep', title: 'System Sleep', type: 'system', timestamp });

const intervalsFor = (events: ActiveWindowEvent[], end = monday + day) => buildIntervals(events, categories, monday, end, end);

describe('focus blocks', () => {
  test('a short glance away keeps one block but does not count as focus', () => {
    const start = monday + 9 * hour;
    const blocks = findFocusBlocks(intervalsFor([work(start), fun(start + 20 * minute), work(start + 21 * minute), sleep(start + 40 * minute)]));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].focusedMs).toBe(39 * minute);
    expect(blocks[0].endedBy).toBe('pause');
  });

  test('a longer distraction ends the block as a drift', () => {
    const start = monday + 9 * hour;
    const blocks = findFocusBlocks(intervalsFor([work(start), fun(start + 30 * minute), work(start + 40 * minute), sleep(start + 50 * minute)]));
    expect(blocks.map((block) => [block.focusedMs, block.endedBy])).toEqual([
      [30 * minute, 'drift'],
      [10 * minute, 'pause'],
    ]);
  });

  test('sleep longer than the tolerance splits blocks', () => {
    const start = monday + 9 * hour;
    const blocks = findFocusBlocks(intervalsFor([work(start), sleep(start + 30 * minute), work(start + 60 * minute), sleep(start + 90 * minute)]));
    expect(blocks).toHaveLength(2);
  });
});

describe('distraction episodes', () => {
  test('merges contiguous distractions and remembers what came before', () => {
    const start = monday + 9 * hour;
    const episodes = findDistractionEpisodes(
      intervalsFor([work(start, 'Mail'), fun(start + 5 * minute), fun(start + 8 * minute, { pageKind: 'social' }), work(start + 20 * minute), sleep(start + 30 * minute)])
    );
    expect(episodes).toHaveLength(1);
    expect(episodes[0].durationMs).toBe(15 * minute);
    expect(episodes[0].sourceKey).toBe('web:Firefox:social');
    expect(episodes[0].gatewayKey).toBe('app:Mail');
    expect(episodes[0].returnedToFocus).toBe(true);
  });
});

describe('period insights', () => {
  const buildWeek = () => {
    const events: ActiveWindowEvent[] = [];
    for (let offset = 0; offset < 5; offset += 1) {
      const morning = monday + offset * day + 9 * hour;
      events.push(work(morning), fun(morning + 50 * minute), work(morning + 70 * minute), sleep(morning + 2 * hour));
    }
    // Last week: half the deep work.
    for (let offset = 0; offset < 5; offset += 1) {
      const morning = previousMonday + offset * day + 9 * hour;
      events.push(work(morning), sleep(morning + 30 * minute));
    }
    return events.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  };

  test('summarises focus, deep work and the comparison period', () => {
    const insights = calculatePeriodInsights({
      events: buildWeek(),
      categories,
      runs: [],
      startDateMs: monday,
      endDateMs: monday + 7 * day,
      previousStartDateMs: previousMonday,
      nowMs: monday + 7 * day,
    });
    expect(insights.summary.focusedMs).toBe(5 * 100 * minute);
    expect(insights.summary.distractedMs).toBe(5 * 20 * minute);
    expect(insights.summary.deepBlocks).toBe(10);
    expect(insights.summary.longestBlockMs).toBe(50 * minute);
    expect(insights.previous.focusedMs).toBe(5 * 30 * minute);
    expect(insights.goldenWindow?.startHour).toBe(9);
    expect(insights.heatmap.focusedMs[0][9]).toBe(50 * minute);
    expect(insights.heatmap.weekdayDays).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(insights.distractions.sources[0].label).toBe('Entertainment in Firefox');
    expect(insights.distractions.sources[0].examples).toEqual(['YouTube video']);
    expect(insights.suggestions.length).toBeGreaterThan(0);
    expect(insights.suggestions.map((suggestion) => suggestion.id)).toContain('golden-window');
  });

  test('a period in progress is compared with the same elapsed time before', () => {
    const insights = calculatePeriodInsights({
      events: buildWeek(),
      categories,
      runs: [],
      startDateMs: monday,
      endDateMs: monday + 7 * day,
      previousStartDateMs: previousMonday,
      nowMs: monday + day + 12 * hour,
    });
    expect(insights.previousRange.endDateMs).toBe(previousMonday + day + 12 * hour);
    expect(insights.previous.focusedMs).toBe(2 * 30 * minute);
    expect(insights.summary.focusedMs).toBe(2 * 100 * minute);
  });

  test('measures sessions by classified activity and compares estimates', () => {
    const events = buildWeek();
    const runs: InsightRun[] = [0, 1, 2].map((offset) => {
      const startedAtMs = monday + offset * day + 9 * hour;
      return {
        run: {
          id: `r${offset}`,
          kind: 'custom',
          startedAtMs,
          taskTarget: { goalSnapshot: 'Write thesis', estimatedMinutes: 60 },
          phases: [{ kind: 'work', goal: 'Write thesis', startedAtMs, completedAtMs: startedAtMs + 90 * minute, plannedDurationMs: 90 * minute, activeElapsedMs: 90 * minute }],
        },
        endedAtMs: startedAtMs + 90 * minute,
        outcome: 'completed',
      };
    });
    const insights = calculatePeriodInsights({ events, categories, runs, startDateMs: monday, endDateMs: monday + 7 * day, previousStartDateMs: previousMonday, nowMs: monday + 7 * day });
    expect(insights.sessions.count).toBe(3);
    expect(insights.sessions.completed).toBe(3);
    expect(insights.sessions.focusRate).toBeCloseTo(70 / 90, 5);
    expect(insights.sessions.medianFirstDriftMs).toBe(50 * minute);
    expect(insights.sessions.estimate).toEqual({ samples: 3, medianRatio: 1.5 });
    expect(insights.sessions.tasks[0]).toMatchObject({ goal: 'Write thesis', sessions: 3 });
  });

  test('a paused stretch and an overlapping archived phase are not counted as session time', () => {
    const start = monday + 9 * hour;
    // 30 min work, then a 60 min YouTube break while the session is paused, then 30 min work.
    const events = [work(start), fun(start + 30 * minute), work(start + 90 * minute), sleep(start + 2 * hour)];
    const runs: InsightRun[] = [
      {
        run: {
          id: 'paused',
          kind: 'custom',
          startedAtMs: start,
          phases: [
            // Archived without a completion time; only 30 minutes were on the clock.
            { kind: 'work', goal: 'Pandas', startedAtMs: start, completedAtMs: null, plannedDurationMs: 30 * minute, activeElapsedMs: 30 * minute },
            { kind: 'work', goal: 'Pandas', startedAtMs: start + 90 * minute, completedAtMs: start + 2 * hour, plannedDurationMs: 30 * minute, activeElapsedMs: 30 * minute },
          ],
        },
        endedAtMs: start + 2 * hour,
        outcome: 'completed',
      },
    ];
    const insights = calculatePeriodInsights({ events, categories, runs, startDateMs: monday, endDateMs: monday + 7 * day, previousStartDateMs: previousMonday, nowMs: monday + 7 * day });
    // The 5 minutes of slack after the first phase catch part of the break, never the whole hour.
    expect(insights.sessions.tasks[0].focusedMs).toBe(60 * minute);
    expect(insights.sessions.tasks[0].focusRate).toBeGreaterThan(0.9);
    expect(insights.sessions.medianFirstDriftMs).toBe(30 * minute);
  });

  test('generic fallback labels are not shown as distraction examples', () => {
    const start = monday + 9 * hour;
    const events = [fun(start, { activityLabel: 'Distracted by Firefox' }), sleep(start + 30 * minute)];
    const insights = calculatePeriodInsights({ events, categories, runs: [], startDateMs: monday, endDateMs: monday + 7 * day, previousStartDateMs: previousMonday, nowMs: monday + 7 * day });
    expect(insights.distractions.sources[0].examples).toEqual([]);
  });

  test('credits session phases to planner goals, this week and last', () => {
    const start = monday + 9 * hour;
    const events = [work(start), fun(start + 40 * minute), sleep(start + hour)];
    const phase = (startedAtMs: number, taskId: string | null, activeElapsedMs: number) => ({
      kind: 'work' as const,
      goal: 'Chapter 2',
      startedAtMs,
      completedAtMs: startedAtMs + activeElapsedMs,
      plannedDurationMs: activeElapsedMs,
      activeElapsedMs,
      todayPlanTask: taskId ? { taskId } : null,
    });
    const runs: InsightRun[] = [
      { run: { id: 'now', kind: 'custom', startedAtMs: start, phases: [phase(start, null, hour)], taskTarget: { taskId: 'task-a' } }, endedAtMs: start + hour, outcome: 'completed' },
      { run: { id: 'before', kind: 'custom', startedAtMs: start - 7 * day, phases: [phase(start - 7 * day, 'task-a', 2 * hour)] }, endedAtMs: start - 7 * day + 2 * hour, outcome: 'completed' },
    ];
    const insights = calculatePeriodInsights({
      events,
      categories,
      runs,
      startDateMs: monday,
      endDateMs: monday + 7 * day,
      previousStartDateMs: previousMonday,
      nowMs: monday + 7 * day,
      planner: {
        goals: [{ id: 'g', title: 'Thesis', color: 'blue', icon: '', completedAtMs: null, weeklyTargetMinutes: null, createdAtMs: null }],
        taskGoals: { 'task-a': 'g' },
        openTasks: {},
      },
    });
    const goal = insights.goals!.goals[0];
    expect(goal.workMs).toBe(hour);
    expect(goal.focusedMs).toBe(40 * minute);
    expect(goal.previousWorkMs).toBe(2 * hour);
    expect(insights.sessions.count).toBe(1);
  });

  test('leaves goals out while the planner is off', () => {
    const insights = calculatePeriodInsights({ events: [], categories, runs: [], startDateMs: monday, endDateMs: monday + 7 * day, previousStartDateMs: previousMonday, nowMs: monday + 7 * day });
    expect(insights.goals).toBeNull();
  });

  test('stays quiet without data', () => {
    const insights = calculatePeriodInsights({ events: [], categories, runs: [], startDateMs: monday, endDateMs: monday + 7 * day, previousStartDateMs: previousMonday, nowMs: monday + 7 * day });
    expect(insights.summary.trackedMs).toBe(0);
    expect(insights.suggestions).toEqual([]);
    expect(insights.goldenWindow).toBeNull();
    expect(insights.stamina.medianBlockMs).toBeNull();
  });
});
