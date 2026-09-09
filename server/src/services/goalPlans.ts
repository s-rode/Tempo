import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { ActivityCorrectionRuleModel } from '../models/activityCorrectionRule';
import { GoalPlanModel, GoalTask } from '../models/goalPlan';
import { FocusRuntimeModel } from '../models/focusRuntime';
import { User as UserModel } from '../models/user';

export type EffectiveGoalScope = 'session' | 'daily' | 'weekly' | 'none';

export interface EffectiveGoalContext {
  scope: EffectiveGoalScope;
  /** A short primary target for concise UI and interruption copy. */
  primaryGoal: string | null;
  /** All remaining tasks, ordered by the user's explicit priority. */
  dailyTasks: string[];
}

export interface DailyPlanSnapshot {
  dateKey: string;
  timeZone: string;
  isToday: boolean;
  tasks: GoalTask[];
}

export interface CurrentDailyPlanTask {
  task: GoalTask;
  dateKey: string;
}

const migrationVersion = 1;

export const localTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const localDateKey = (timestamp = Date.now()): string => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const weekStartKey = (timestamp = Date.now()): string => {
  const date = new Date(timestamp);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  date.setHours(0, 0, 0, 0);
  return localDateKey(date.getTime());
};

const sortedTasks = (tasks: GoalTask[] | undefined): GoalTask[] =>
  [...(tasks || [])].sort((left, right) => {
    const leftCompleted = left.completedAtMs !== null;
    const rightCompleted = right.completedAtMs !== null;
    if (leftCompleted !== rightCompleted) return leftCompleted ? 1 : -1;
    if (leftCompleted && rightCompleted)
      return (left.completedAtMs || 0) - (right.completedAtMs || 0);
    return left.position - right.position;
  });

const activeTasks = (tasks: GoalTask[] | undefined): GoalTask[] =>
  sortedTasks(tasks).filter((task) => task.completedAtMs === null);

export const legacyGoalFingerprint = (goals: {
  sessionGoal?: string | null;
  dailyGoal?: string | null;
  weeklyGoal?: string | null;
  lifeGoal?: string | null;
}): string =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        sessionGoal: goals.sessionGoal?.trim() || '',
        dailyGoal: goals.dailyGoal?.trim() || '',
        weeklyGoal: goals.weeklyGoal?.trim() || '',
        lifeGoal: goals.lifeGoal?.trim() || '',
      })
    )
    .digest('hex');

export const fingerprintEffectiveGoalContext = (context: EffectiveGoalContext): string =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        version: 2,
        scope: context.scope,
        primaryGoal: context.primaryGoal?.trim() || '',
        dailyTasks: context.dailyTasks.map((task) => task.trim()),
      })
    )
    .digest('hex');

/**
 * Moves only the currently active legacy goal context onto the v2 fingerprint.
 * Older, unmatched rules remain stored rather than becoming accidentally broad.
 */
async function migrateMatchingCorrectionContext(
  userId: string,
  legacyGoals: { dailyGoal?: string; weeklyGoal?: string; lifeGoal?: string },
  context: EffectiveGoalContext
): Promise<void> {
  if (context.scope === 'none') return;
  const oldFingerprint = legacyGoalFingerprint(legacyGoals);
  const newFingerprint = fingerprintEffectiveGoalContext(context);
  // Historical events intentionally retain their original fingerprint: they
  // may have been judged using an old broad context and must not become a
  // reusable precedent for the narrower plan. A correction rule may already
  // have an equivalent v2 rule, however. In that rare collision case,
  // retaining the old rule is safer than broadening it or making the one-time
  // migration prevent Tempo from starting.
  try {
    await ActivityCorrectionRuleModel.updateMany(
      { userId, goalContextFingerprint: oldFingerprint },
      { $set: { goalContextFingerprint: newFingerprint } }
    );
  } catch {
    // Keep unmatched legacy rules intact. No content, URL, or rule detail is
    // logged from this privacy-sensitive migration path.
  }
}

/** Idempotently converts the inherited three strings into scoped plan records. */
export async function ensureGoalPlanMigration(userId: string): Promise<void> {
  const user = await UserModel.findById(userId).select('userGoals goalPlanMigrationVersion').lean();
  if (!user || user.goalPlanMigrationVersion >= migrationVersion) return;

  const legacyGoals = user.userGoals || { dailyGoal: '', weeklyGoal: '', lifeGoal: '' };
  const zone = localTimeZone();
  const now = Date.now();
  const dateKey = localDateKey(now);
  const currentWeekKey = weekStartKey(now);

  if (legacyGoals.dailyGoal?.trim()) {
    await GoalPlanModel.updateOne(
      { userId, scope: 'daily', periodKey: dateKey },
      {
        $setOnInsert: {
          userId,
          scope: 'daily',
          periodKey: dateKey,
          timeZone: zone,
          tasks: [
            {
              id: randomUUID(),
              text: legacyGoals.dailyGoal.trim(),
              position: 0,
              completedAtMs: null,
            },
          ],
          text: '',
        },
      },
      { upsert: true }
    );
  }
  if (legacyGoals.weeklyGoal?.trim()) {
    await GoalPlanModel.updateOne(
      { userId, scope: 'weekly', periodKey: currentWeekKey },
      {
        $setOnInsert: {
          userId,
          scope: 'weekly',
          periodKey: currentWeekKey,
          timeZone: zone,
          tasks: [],
          text: legacyGoals.weeklyGoal.trim(),
        },
      },
      { upsert: true }
    );
  }
  if (legacyGoals.lifeGoal?.trim()) {
    await GoalPlanModel.updateOne(
      { userId, scope: 'direction', periodKey: 'current' },
      {
        $setOnInsert: {
          userId,
          scope: 'direction',
          periodKey: 'current',
          timeZone: zone,
          tasks: [],
          text: legacyGoals.lifeGoal.trim(),
        },
      },
      { upsert: true }
    );
  }

  const daily = legacyGoals.dailyGoal?.trim()
    ? {
        scope: 'daily' as const,
        primaryGoal: legacyGoals.dailyGoal.trim(),
        dailyTasks: [legacyGoals.dailyGoal.trim()],
      }
    : legacyGoals.weeklyGoal?.trim()
      ? { scope: 'weekly' as const, primaryGoal: legacyGoals.weeklyGoal.trim(), dailyTasks: [] }
      : { scope: 'none' as const, primaryGoal: null, dailyTasks: [] };
  await migrateMatchingCorrectionContext(userId, legacyGoals, daily);
  await UserModel.findByIdAndUpdate(userId, {
    $set: { goalPlanMigrationVersion: migrationVersion },
  });
}

export async function getDailyPlan(
  userId: string,
  timestamp = Date.now()
): Promise<DailyPlanSnapshot> {
  await ensureGoalPlanMigration(userId);
  const dateKey = localDateKey(timestamp);
  const plan = await GoalPlanModel.findOne({ userId, scope: 'daily', periodKey: dateKey }).lean();
  return {
    dateKey,
    timeZone: plan?.timeZone || localTimeZone(),
    isToday: dateKey === localDateKey(),
    tasks: sortedTasks((plan?.tasks || []) as GoalTask[]),
  };
}

/**
 * Resolves an unfinished task only from today's local plan. The focus-runtime
 * router uses this rather than trusting a renderer-provided task label.
 */
export async function getCurrentDailyPlanTask(
  userId: string,
  taskId: string
): Promise<CurrentDailyPlanTask | null> {
  const plan = await getDailyPlan(userId);
  const task = plan.tasks.find((entry) => entry.id === taskId && entry.completedAtMs === null);
  return task ? { task, dateKey: plan.dateKey } : null;
}

export async function getCurrentPlanning(
  userId: string,
  now = Date.now()
): Promise<{
  weekStartKey: string;
  timeZone: string;
  weeklyFocus: string;
  longTermDirection: string;
}> {
  await ensureGoalPlanMigration(userId);
  const currentWeekKey = weekStartKey(now);
  const [weekly, direction] = await Promise.all([
    GoalPlanModel.findOne({ userId, scope: 'weekly', periodKey: currentWeekKey }).lean(),
    GoalPlanModel.findOne({ userId, scope: 'direction', periodKey: 'current' }).lean(),
  ]);
  return {
    weekStartKey: currentWeekKey,
    timeZone: weekly?.timeZone || direction?.timeZone || localTimeZone(),
    weeklyFocus: weekly?.text || '',
    longTermDirection: direction?.text || '',
  };
}

export async function resolveEffectiveGoalContext(userId: string): Promise<EffectiveGoalContext> {
  await ensureGoalPlanMigration(userId);
  const runtime = (await FocusRuntimeModel.findOne({ userId }).select('run').lean()) as any;
  const phase =
    runtime?.run?.state === 'active' ? runtime.run.phases?.[runtime.run.currentPhaseIndex] : null;
  if (phase?.kind === 'work' && phase?.state === 'running' && phase.goal?.trim()) {
    return { scope: 'session', primaryGoal: phase.goal.trim(), dailyTasks: [] };
  }

  const now = Date.now();
  const [daily, weekly] = await Promise.all([
    GoalPlanModel.findOne({ userId, scope: 'daily', periodKey: localDateKey(now) }).lean(),
    GoalPlanModel.findOne({ userId, scope: 'weekly', periodKey: weekStartKey(now) }).lean(),
  ]);
  const remaining = activeTasks((daily?.tasks || []) as GoalTask[]).map((task) => task.text.trim());
  if (remaining.length) {
    return { scope: 'daily', primaryGoal: remaining[0], dailyTasks: remaining };
  }
  if (weekly?.text?.trim()) {
    return { scope: 'weekly', primaryGoal: weekly.text.trim(), dailyTasks: [] };
  }
  return { scope: 'none', primaryGoal: null, dailyTasks: [] };
}

export const goalPeriodFor = {
  dayKey: localDateKey,
  weekKey: weekStartKey,
  sortedTasks,
};
