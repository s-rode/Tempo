import { beforeEach, describe, expect, jest, mock, test } from 'bun:test';

const users = { findById: jest.fn(), findByIdAndUpdate: jest.fn() };
const goalPlans = { findOne: jest.fn(), updateOne: jest.fn(), updateMany: jest.fn() };
const focusRuntime = { findOne: jest.fn() };
const corrections = { updateMany: jest.fn() };
const supportProfiles = { find: jest.fn() };

mock.module('../models/user', () => ({ User: users }));
mock.module('../models/goalPlan', () => ({ GoalPlanModel: goalPlans }));
mock.module('../models/focusRuntime', () => ({
  FocusRuntimeModel: focusRuntime,
  // The pure focus-runtime suite imports both exports in the same Bun process.
  // It never touches history persistence, but keeping the module shape intact
  // makes this isolated model mock harmless to that suite.
  FocusRunHistoryModel: {},
}));
mock.module('../models/activityCorrectionRule', () => ({
  ActivityCorrectionRuleModel: corrections,
}));
mock.module('../models/goalSupportProfile', () => ({ GoalSupportProfileModel: supportProfiles }));

const {
  ensureGoalPlanMigration,
  fingerprintEffectiveGoalContext,
  fingerprintClassificationContext,
  getCurrentDailyPlanTask,
  getDailyPlan,
  goalPeriodFor,
  resolveEffectiveGoalContext,
} = await import('./goalPlans');

const findChain = (value: unknown) => ({ lean: jest.fn().mockResolvedValue(value) });

describe('Tempo goal plans', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    users.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ goalPlanMigrationVersion: 1, userGoals: {} }),
    });
    focusRuntime.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(null),
    });
    goalPlans.findOne.mockReturnValue(findChain(null));
    goalPlans.updateMany.mockResolvedValue({});
    supportProfiles.find.mockReturnValue(findChain([]));
  });

  test('uses a running work-phase goal ahead of every persisted plan', async () => {
    focusRuntime.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        run: {
          state: 'active',
          currentPhaseIndex: 0,
          phases: [{ kind: 'work', state: 'running', goal: 'Finish the ML exercise set' }],
        },
      }),
    });

    expect(await resolveEffectiveGoalContext('user')).toMatchObject({
      scope: 'session',
      primaryGoal: 'Finish the ML exercise set',
      dailyTasks: [],
    });
    expect(goalPlans.findOne).not.toHaveBeenCalled();
  });

  test('uses only unchecked daily tasks, ordered by the plan priority', async () => {
    goalPlans.findOne
      .mockReturnValueOnce(
        findChain({
          tasks: [
            { id: 'later', text: 'Read the paper', position: 2, completedAtMs: null },
            { id: 'done', text: 'Finished task', position: 0, completedAtMs: 1 },
            { id: 'first', text: 'Solve the exercise', position: 1, completedAtMs: null },
          ],
        })
      )
      .mockReturnValueOnce(findChain({ text: 'Prepare for the exam' }));

    expect(await resolveEffectiveGoalContext('user')).toMatchObject({
      scope: 'daily',
      primaryGoal: 'Solve the exercise',
      dailyTasks: ['Solve the exercise', 'Read the paper'],
    });
  });

  test('resolves only an unfinished task from today’s plan', async () => {
    goalPlans.findOne.mockReturnValue(
      findChain({
        timeZone: 'Europe/Berlin',
        tasks: [
          { id: 'active', text: 'Solve the exercise', position: 0, completedAtMs: null },
          { id: 'done', text: 'Submit notes', position: 1, completedAtMs: 1 },
        ],
      })
    );

    expect(await getCurrentDailyPlanTask('user', 'active')).toMatchObject({
      task: { id: 'active', text: 'Solve the exercise' },
    });
    expect(await getCurrentDailyPlanTask('user', 'done')).toBeNull();
    expect(await getCurrentDailyPlanTask('user', 'missing')).toBeNull();
  });

  test('keeps estimates on historical plan snapshots without making them classification goals', async () => {
    goalPlans.findOne.mockReturnValue(findChain({
      timeZone: 'Europe/Berlin',
      tasks: [{ id: 'estimated', text: 'Review algorithms', estimatedMinutes: 90,
        position: 0, completedAtMs: null }],
    }));
    const historical = await getDailyPlan('user', new Date(2026, 8, 8, 12).getTime());
    expect(historical.isToday).toBe(false);
    expect(historical.tasks[0]).toMatchObject({ text: 'Review algorithms', estimatedMinutes: 90 });
    expect(await getCurrentDailyPlanTask('user', 'estimated')).toMatchObject({
      task: { estimatedMinutes: 90 },
    });
  });

  test('falls back to the weekly focus only after every daily task is complete', async () => {
    goalPlans.findOne
      .mockReturnValueOnce(
        findChain({ tasks: [{ id: 'done', text: 'Completed', position: 0, completedAtMs: 1 }] })
      )
      .mockReturnValueOnce(findChain({ text: 'Prepare for the exam' }));

    expect(await resolveEffectiveGoalContext('user')).toMatchObject({
      scope: 'weekly',
      primaryGoal: 'Prepare for the exam',
      dailyTasks: [],
    });
  });

  test('returns no classification goal without session, remaining task, or weekly focus', async () => {
    expect(await resolveEffectiveGoalContext('user')).toMatchObject({
      scope: 'none',
      primaryGoal: null,
      dailyTasks: [],
    });
  });

  test('includes scope and task order in correction/history fingerprints', () => {
    const first = fingerprintEffectiveGoalContext({
      scope: 'daily',
      primaryGoal: 'First task',
      dailyTasks: ['First task', 'Second task'],
    });
    const reordered = fingerprintEffectiveGoalContext({
      scope: 'daily',
      primaryGoal: 'Second task',
      dailyTasks: ['Second task', 'First task'],
    });
    expect(first).not.toBe(reordered);
  });

  test('keeps manual-correction scope stable while guardrails invalidate model history', () => {
    const withoutGuardrail = {
      scope: 'weekly' as const,
      primaryGoal: 'Prepare for the exam',
      dailyTasks: [],
      targets: [],
      attentionGuardrail: null,
    };
    const withGuardrail = { ...withoutGuardrail, attentionGuardrail: 'Avoid mindless browsing.' };
    expect(fingerprintEffectiveGoalContext(withoutGuardrail)).toBe(
      fingerprintEffectiveGoalContext(withGuardrail)
    );
    expect(fingerprintClassificationContext(withoutGuardrail)).not.toBe(
      fingerprintClassificationContext(withGuardrail)
    );
  });

  test('invalidates automatic history when classifier strictness changes', () => {
    const context = {
      scope: 'weekly' as const,
      primaryGoal: 'Study probability',
      dailyTasks: [],
      targets: [],
      attentionGuardrail: null,
    };
    expect(fingerprintClassificationContext(context, 'flexible')).not.toBe(
      fingerprintClassificationContext(context, 'strict')
    );
  });

  test('migrates inherited goal strings once without discarding their backup', async () => {
    let version = 0;
    users.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockImplementation(async () => ({
        goalPlanMigrationVersion: version,
        userGoals: {
          dailyGoal: 'Finish notes',
          weeklyGoal: 'Prepare for the exam',
          lifeGoal: 'Become a stronger researcher',
        },
      })),
    });
    users.findByIdAndUpdate.mockImplementation(async () => {
      version = 2;
    });
    goalPlans.updateOne.mockResolvedValue({});
    corrections.updateMany.mockResolvedValue({});

    await ensureGoalPlanMigration('user');
    expect(goalPlans.updateOne).toHaveBeenCalledTimes(3);
    expect(goalPlans.updateOne.mock.calls[0][1].$setOnInsert.tasks[0]).toMatchObject({
      text: 'Finish notes',
      completedAtMs: null,
    });
    await ensureGoalPlanMigration('user');
    expect(goalPlans.updateOne).toHaveBeenCalledTimes(3);
    expect(users.findByIdAndUpdate).toHaveBeenCalledWith('user', {
      $set: { goalPlanMigrationVersion: 2 },
    });
  });

  test('uses local calendar keys for a daily plan and its Monday week', () => {
    expect(goalPeriodFor.dayKey(new Date(2026, 8, 8, 12).getTime())).toBe('2026-09-08');
    expect(goalPeriodFor.weekKey(new Date(2026, 8, 6, 12).getTime())).toBe('2026-08-31');
    expect(goalPeriodFor.weekKey(new Date(2026, 8, 7, 12).getTime())).toBe('2026-09-07');
  });
});
