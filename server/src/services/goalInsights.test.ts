import { describe, expect, test } from 'bun:test';
import { analyzeGoals, type GoalInsightGoal, type GoalPhaseWork, type GoalPlannerInput } from './goalInsights';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const monday = new Date(2026, 8, 7, 0, 0, 0, 0).getTime();
const nextMonday = monday + 7 * day;

const goal = (id: string, extra: Partial<GoalInsightGoal> = {}): GoalInsightGoal => ({
  id,
  title: id === 'thesis' ? 'Thesis' : id === 'spanish' ? 'Spanish' : 'Running',
  color: 'blue',
  icon: '',
  completedAtMs: null,
  weeklyTargetMinutes: null,
  createdAtMs: monday - 30 * day,
  ...extra,
});

const planner = (goals: GoalInsightGoal[], openTasks: Record<string, string[]> = {}): GoalPlannerInput => ({
  goals,
  taskGoals: { t1: 'thesis', t2: 'thesis', s1: 'spanish', r1: 'running' },
  openTasks,
});

const work = (taskId: string | null, workMs: number, focusedMs = workMs, distractedMs = 0): GoalPhaseWork => ({ taskId, workMs, focusedMs, distractedMs });

const analyze = (args: { goals: GoalInsightGoal[]; phases: GoalPhaseWork[]; previous?: GoalPhaseWork[]; nowMs: number; openTasks?: Record<string, string[]> }) =>
  analyzeGoals({
    planner: planner(args.goals, args.openTasks),
    phases: args.phases,
    previousPhases: args.previous || [],
    startDateMs: monday,
    endDateMs: nextMonday,
    effectiveEndMs: Math.min(nextMonday, args.nowMs),
  });

describe('goal time', () => {
  test('credits work phases to the goal of their task and keeps the rest as unlinked', () => {
    const result = analyze({
      goals: [goal('thesis'), goal('spanish')],
      phases: [work('t1', hour), work('t2', 30 * minute), work('s1', 30 * minute), work(null, hour)],
      nowMs: nextMonday,
    });
    expect(result.totalWorkMs).toBe(3 * hour);
    expect(result.linkedMs).toBe(2 * hour);
    expect(result.unlinkedMs).toBe(hour);
    const thesis = result.goals.find((row) => row.id === 'thesis')!;
    expect(thesis.workMs).toBe(90 * minute);
    expect(thesis.share).toBeCloseTo(0.5);
    expect(thesis.sessions).toBe(2);
    expect(result.goals[0].id).toBe('thesis');
  });

  test('a weekly target is pro-rated while the week runs', () => {
    // Thursday noon: three full days of seven have passed, today is open.
    const result = analyze({
      goals: [goal('thesis', { weeklyTargetMinutes: 700 })],
      phases: [work('t1', 2 * hour)],
      nowMs: monday + 3.5 * day,
    });
    const thesis = result.goals[0];
    expect(thesis.targetMs).toBe(700 * minute);
    expect(thesis.expectedByNowMs).toBe(300 * minute);
    expect(thesis.status).toBe('behind');
    expect(result.suggestions[0].id).toBe('goal-behind-thesis');
    expect(result.suggestions[0].body).toContain('2h of the 11h 40m');
    expect(result.suggestions[0].body).toContain('a day over the last 4 days');
  });

  test('a goal created mid-week is only held to the rest of it', () => {
    const result = analyze({
      goals: [goal('thesis', { weeklyTargetMinutes: 420, createdAtMs: monday + 4 * day + 9 * hour })],
      phases: [],
      nowMs: monday + 4 * day + 10 * hour,
    });
    expect(result.goals[0].targetMs).toBe(3 * hour);
    expect(result.goals[0].status).toBe('on_pace');
  });

  test('reaching the target is reported as momentum, not as a problem', () => {
    const result = analyze({
      goals: [goal('thesis', { weeklyTargetMinutes: 120 })],
      phases: [work('t1', 150 * minute)],
      nowMs: monday + 2 * day,
    });
    expect(result.goals[0].status).toBe('reached');
    expect(result.suggestions.map((entry) => entry.kind)).toEqual(['momentum']);
  });
});

describe('goal suggestions', () => {
  test('a goal without time names its next open task', () => {
    const result = analyze({
      goals: [goal('thesis'), goal('spanish')],
      phases: [work('t1', 3 * hour)],
      nowMs: monday + 5 * day,
      openTasks: { spanish: ['Review verbs', 'Podcast episode'] },
    });
    const untouched = result.suggestions.find((entry) => entry.id === 'goal-untouched-spanish');
    expect(untouched?.body).toContain('“Review verbs”');
    expect(untouched?.body).toContain('2 open tasks');
  });

  test('a finished week that missed the target says it fell short', () => {
    const result = analyze({
      goals: [goal('thesis', { weeklyTargetMinutes: 600 })],
      phases: [work('t1', 4 * hour)],
      nowMs: nextMonday + day,
    });
    expect(result.suggestions[0].title).toBe('Thesis fell short');
  });

  test('much session time without a goal is called out', () => {
    const result = analyze({
      goals: [goal('thesis', { weeklyTargetMinutes: 60 })],
      phases: [work('t1', hour), work(null, 3 * hour)],
      nowMs: monday + 5 * day,
    });
    expect(result.suggestions.some((entry) => entry.id === 'goal-unlinked')).toBe(true);
  });

  test('a goal without a target that got far less than last time is slipping', () => {
    const result = analyze({
      goals: [goal('thesis')],
      phases: [work('t1', 20 * minute)],
      previous: [work('t1', 3 * hour)],
      nowMs: monday + 4 * day,
    });
    expect(result.suggestions[0].id).toBe('goal-slipping-thesis');
  });

  test('the goal whose sessions drift most is named', () => {
    const result = analyze({
      goals: [goal('thesis'), goal('spanish')],
      phases: [work('t1', 2 * hour, 110 * minute, 10 * minute), work('s1', 2 * hour, 60 * minute, 60 * minute)],
      nowMs: monday + 4 * day,
    });
    expect(result.suggestions.some((entry) => entry.id === 'goal-drift-spanish')).toBe(true);
  });

  test('goals achieved before the period stay out unless they got time', () => {
    const result = analyze({
      goals: [goal('thesis', { completedAtMs: monday - day }), goal('spanish', { completedAtMs: monday - day })],
      phases: [work('s1', hour)],
      nowMs: monday + 2 * day,
    });
    expect(result.goals.map((row) => row.id)).toEqual(['spanish']);
    expect(result.suggestions).toEqual([]);
  });
});
