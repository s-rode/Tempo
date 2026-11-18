import { beforeEach, describe, expect, jest, mock, test } from 'bun:test';

const users = { findById: jest.fn() };
const goalPlans = { find: jest.fn(), findOne: jest.fn(), updateOne: jest.fn() };

mock.module('../models/user', () => ({ User: users }));
mock.module('../models/goalPlan', () => ({ GoalPlanModel: goalPlans }));

const { forgetPlannerState, forgetRollover, getPlannerState, rollOverUnfinished } = await import(
  './plannerState'
);

const lean = (value: unknown) => ({ lean: jest.fn().mockResolvedValue(value) });
const userWith = (settings: Record<string, unknown> | undefined) =>
  users.findById.mockReturnValue({
    select: jest.fn().mockReturnValue(lean(settings ? { electronAppSettings: settings } : null)),
  });
const task = (id: string, position: number, completedAtMs: number | null = null) => ({
  id,
  text: id,
  position,
  completedAtMs,
});
const NOW = new Date(2026, 10, 18, 10, 0).getTime();

describe('planner carry-over', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    forgetRollover('user-1');
    forgetPlannerState('user-1');
    goalPlans.updateOne.mockResolvedValue({});
  });

  test('Reminders stays the default source', async () => {
    userWith({});
    expect(await getPlannerState('user-1')).toEqual({ enabled: false, sinceDateKey: null });
    forgetPlannerState('user-1');
    userWith(undefined);
    expect((await getPlannerState('user-1')).enabled).toBe(false);
  });

  test('remembers the source until it is changed', async () => {
    userWith({ planningSource: 'planner' });
    expect((await getPlannerState('user-1')).enabled).toBe(true);
    userWith({ planningSource: 'reminders' });
    expect((await getPlannerState('user-1')).enabled).toBe(true);
    expect(users.findById).toHaveBeenCalledTimes(1);
    forgetPlannerState('user-1');
    expect((await getPlannerState('user-1')).enabled).toBe(false);
  });

  test('does nothing while the planner is off', async () => {
    userWith({ planningSource: 'reminders' });
    expect(await rollOverUnfinished('user-1', NOW)).toBe(false);
    expect(goalPlans.find).not.toHaveBeenCalled();
    expect(goalPlans.updateOne).not.toHaveBeenCalled();
  });

  test('moves unfinished tasks to the end of today and leaves finished ones in place', async () => {
    userWith({ planningSource: 'planner', plannerSinceDateKey: '2026-11-10' });
    goalPlans.find.mockReturnValue(
      lean([{ periodKey: '2026-11-17', tasks: [task('late', 0), task('finished', 0, 5)] }])
    );
    goalPlans.findOne.mockReturnValue(lean({ tasks: [task('today', 0)] }));

    expect(await rollOverUnfinished('user-1', NOW)).toBe(true);

    // Only days since the planner was switched on are considered.
    expect(goalPlans.find.mock.calls[0][0].periodKey).toEqual({
      $gte: '2026-11-10',
      $lt: '2026-11-18',
    });
    const [todayFilter, todayUpdate] = goalPlans.updateOne.mock.calls[0];
    expect(todayFilter.periodKey).toBe('2026-11-18');
    expect(todayUpdate.$set.tasks.map((entry: any) => [entry.id, entry.position])).toEqual([
      ['today', 0],
      ['late', 1],
    ]);
    expect(todayUpdate.$set.tasks[1].carriedFromDateKey).toBe('2026-11-17');
    const [pastFilter, pastUpdate] = goalPlans.updateOne.mock.calls[1];
    expect(pastFilter.periodKey).toBe('2026-11-17');
    expect(pastUpdate.$set.tasks.map((entry: any) => entry.id)).toEqual(['finished']);
  });

  test('runs once per day until asked again', async () => {
    userWith({ planningSource: 'planner', plannerSinceDateKey: '2026-11-10' });
    goalPlans.find.mockReturnValue(lean([]));
    await rollOverUnfinished('user-1', NOW);
    await rollOverUnfinished('user-1', NOW);
    expect(goalPlans.find).toHaveBeenCalledTimes(1);
    forgetRollover('user-1');
    await rollOverUnfinished('user-1', NOW);
    expect(goalPlans.find).toHaveBeenCalledTimes(2);
  });

  test('overlapping reads carry a task over only once', async () => {
    userWith({ planningSource: 'planner', plannerSinceDateKey: '2026-11-10' });
    goalPlans.find.mockReturnValue(lean([{ periodKey: '2026-11-17', tasks: [task('late', 0)] }]));
    goalPlans.findOne.mockReturnValue(lean(null));
    const results = await Promise.all([
      rollOverUnfinished('user-1', NOW),
      rollOverUnfinished('user-1', NOW),
    ]);
    expect(results).toEqual([true, false]);
    expect(goalPlans.updateOne).toHaveBeenCalledTimes(2);
  });
});
