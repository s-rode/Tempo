import crypto from 'crypto';
import { getReminderIntegration, getReminderTasks } from './reminders';
import { randomUUID } from 'crypto';
import { ActivityCorrectionRuleModel } from '../models/activityCorrectionRule';
import { GoalSupportProfileModel } from '../models/goalSupportProfile';
import { GoalPlanModel, GoalTask } from '../models/goalPlan';
import { FocusRuntimeModel } from '../models/focusRuntime';
import { User as UserModel } from '../models/user';
import {
  GOAL_SUPPORT_PROFILE_POLICY_VERSION,
  GoalSupportProfileData,
  isSupportingMode,
} from './categorization/goalSupportTypes';
import type { ClassifierStrictness } from '../../../shared/types';
import type { ClassificationContextSnapshot } from '../../../shared/classification';
import { PERSONALIZED_POLICY_VERSION } from './categorization/personalizedPolicy';

export type EffectiveGoalScope = 'session' | 'daily' | 'weekly' | 'none';

export interface EffectiveGoalContext {
  sessionId?: string | null;
  scope: EffectiveGoalScope;
  /** A short primary target for concise UI and interruption copy. */
  primaryGoal: string | null;
  /** All remaining tasks, ordered by the user's explicit priority. */
  dailyTasks: string[];
  /** Individually addressable active targets for model validation. */
  targets?: EffectiveGoalTarget[];
  /** An optional weekly ambiguity guardrail; it is never a productive target. */
  attentionGuardrail?: string | null;
}

export interface EffectiveGoalTarget {
  taskKey?: string;
  listKey?: string | null;
  listName?: string | null;
  listContext?: string | null;
  classificationText?: string;
  ref: string;
  scope: Exclude<EffectiveGoalScope, 'none'>;
  text: string;
  textFingerprint: string;
  supportProfile: GoalSupportProfileData | null;
}

export interface DailyPlanSnapshot {
  canCopyToToday?: boolean;
  source?: 'manual' | 'reminder';
  canStart?: boolean;
  dateKey: string;
  timeZone: string;
  isToday: boolean;
  tasks: GoalTask[];
}

export interface CurrentDailyPlanTask {
  task: GoalTask;
  dateKey: string;
}

const migrationVersion = 2;

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
        ...(context.targets?.some((item) => item.classificationText)
          ? {
              classificationTargets: context.targets.map(
                (item) => item.classificationText || item.text
              ),
            }
          : {}),
      })
    )
    .digest('hex');

/**
 * History/cache reuse must include the policy and profile revisions. Manual
 * correction rules intentionally continue to use fingerprintEffectiveGoalContext.
 */
export const fingerprintClassificationContext = (
  context: EffectiveGoalContext,
  strictness: ClassifierStrictness = 'strict',
  learningRevision = 0
): string =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        // Unlike manual corrections, reusable model/history decisions must be
        // invalidated whenever the relation policy, an active support profile,
        // or the ambiguity-only weekly guardrail changes.
        version:
          process.env.TEMPO_PERSONALIZED_CLASSIFIER === 'disabled'
            ? 'semantic-grounded-v1-learning'
            : PERSONALIZED_POLICY_VERSION,
        provenance: context.targets?.map((t) => [t.taskKey, t.listKey, t.listContext]),
        strictness,
        learningRevision,
        effective: fingerprintEffectiveGoalContext(context),
        attentionGuardrail: context.attentionGuardrail?.trim() || '',
        profiles: (context.targets || []).map((target) => ({
          ref: target.ref,
          textFingerprint: target.textFingerprint,
          revision: target.supportProfile?.revision || 'pending',
          expectedOutcome: target.supportProfile?.expectedOutcome || '',
        })),
      })
    )
    .digest('hex');

export const fingerprintGoalText = (text: string): string =>
  crypto.createHash('sha256').update(text.trim()).digest('hex');

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

  if (user.goalPlanMigrationVersion < 1 && legacyGoals.dailyGoal?.trim()) {
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
          focusText: '',
          attentionGuardrail: '',
        },
      },
      { upsert: true }
    );
  }
  if (user.goalPlanMigrationVersion < 1 && legacyGoals.weeklyGoal?.trim()) {
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
          focusText: legacyGoals.weeklyGoal.trim(),
          attentionGuardrail: '',
          focusReviewPending: true,
        },
      },
      { upsert: true }
    );
  }
  if (user.goalPlanMigrationVersion < 1 && legacyGoals.lifeGoal?.trim()) {
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
        targets: [],
        attentionGuardrail: null,
      }
    : legacyGoals.weeklyGoal?.trim()
      ? {
          scope: 'weekly' as const,
          primaryGoal: legacyGoals.weeklyGoal.trim(),
          dailyTasks: [],
          targets: [],
          attentionGuardrail: null,
        }
      : {
          scope: 'none' as const,
          primaryGoal: null,
          dailyTasks: [],
          targets: [],
          attentionGuardrail: null,
        };
  if (user.goalPlanMigrationVersion < 1)
    await migrateMatchingCorrectionContext(userId, legacyGoals, daily);

  // Version 2 splits previously persisted weekly free-form text into a
  // positive classification target and an optional empty guardrail. This is
  // an idempotent database-side migration, so it neither rewrites user text
  // nor loads it into logs or a model.
  await GoalPlanModel.updateMany(
    {
      userId,
      scope: 'weekly',
      text: { $type: 'string', $ne: '' },
      $or: [{ focusText: { $exists: false } }, { focusText: '' }, { focusText: null }],
    },
    [
      {
        $set: {
          focusText: '$text',
          attentionGuardrail: { $ifNull: ['$attentionGuardrail', ''] },
          focusReviewPending: true,
        },
      },
    ]
  );
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
  if (dateKey === localDateKey()) {
    const reminders = await getReminderTasks(userId);
    if (reminders.enabled)
      return {
        dateKey,
        timeZone: localTimeZone(),
        isToday: true,
        source: 'reminder',
        canStart: reminders.canStart,
        tasks: reminders.tasks,
      };
  }
  const plan = await GoalPlanModel.findOne({ userId, scope: 'daily', periodKey: dateKey }).lean();
  return {
    dateKey,
    timeZone: plan?.timeZone || localTimeZone(),
    isToday: dateKey === localDateKey(),
    canCopyToToday: dateKey === localDateKey() || !(await getReminderIntegration(userId))?.enabled,
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
  attentionGuardrail: string;
  needsWeeklyFocusReview: boolean;
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
    weeklyFocus: weekly?.focusText || weekly?.text || '',
    attentionGuardrail: weekly?.attentionGuardrail || '',
    needsWeeklyFocusReview: Boolean(
      weekly?.focusReviewPending || (weekly?.text?.trim() && !weekly?.focusText?.trim())
    ),
    longTermDirection: direction?.text || '',
  };
}

const target = (
  ref: string,
  scope: Exclude<EffectiveGoalScope, 'none'>,
  text: string,
  classificationText?: string,
  provenance?: { taskId?: string; listId?: string; listName?: string; listContext?: string }
): EffectiveGoalTarget => ({
  taskKey:
    provenance?.taskId || fingerprintGoalText(text.toLowerCase().replace(/\s+/g, ' ').trim()),
  listKey: provenance?.listId
    ? crypto
        .createHmac('sha256', process.env.AUTH_SECRET || 'local-development-secret')
        .update(`list:${provenance.listId}`)
        .digest('hex')
    : null,
  listName: provenance?.listName?.slice(0, 100) || null,
  listContext: provenance?.listContext?.slice(0, 1000) || null,
  ref,
  scope,
  text,
  ...(classificationText ? { classificationText } : {}),
  textFingerprint: fingerprintGoalText(classificationText || text),
  supportProfile: null,
});

async function attachSupportProfiles(
  userId: string,
  context: EffectiveGoalContext
): Promise<EffectiveGoalContext> {
  if (!context.targets?.length) return context;
  const profiles = await GoalSupportProfileModel.find({
    userId,
    policyVersion: GOAL_SUPPORT_PROFILE_POLICY_VERSION,
    $or: context.targets.map((item) => ({
      goalRef: { $in: [item.ref, `profile:${item.textFingerprint}`] },
      goalTextFingerprint: item.textFingerprint,
    })),
  }).lean();
  const byTarget = new Map(
    profiles.map((profile) => [
      `${profile.goalRef}:${profile.goalTextFingerprint}`,
      {
        subjectCues: (profile.subjectCues || [])
          .filter((value): value is string => typeof value === 'string')
          .slice(0, 6),
        expectedOutcome:
          typeof profile.expectedOutcome === 'string' ? profile.expectedOutcome.slice(0, 120) : '',
        supportingModes: (profile.supportingModes || []).filter(isSupportingMode).slice(0, 5),
        revision: profile.revision,
      } satisfies GoalSupportProfileData,
    ])
  );
  return {
    ...context,
    targets: context.targets.map((item) => ({
      ...item,
      supportProfile:
        byTarget.get(`profile:${item.textFingerprint}:${item.textFingerprint}`) ||
        byTarget.get(`${item.ref}:${item.textFingerprint}`) ||
        null,
    })),
  };
}

export async function resolveEffectiveGoalContext(userId: string): Promise<EffectiveGoalContext> {
  await ensureGoalPlanMigration(userId);
  const runtime = (await FocusRuntimeModel.findOne({ userId }).select('run').lean()) as any;
  const phase =
    runtime?.run?.state === 'active' ? runtime.run.phases?.[runtime.run.currentPhaseIndex] : null;
  if (phase?.kind === 'work' && phase?.state === 'running' && phase.goal?.trim()) {
    return attachSupportProfiles(userId, {
      scope: 'session',
      sessionId: runtime.run.id,
      primaryGoal: phase.goal.trim(),
      dailyTasks: [],
      targets: [
        target(
          `session:${runtime.run.id}:${phase.id}`,
          'session',
          phase.goal.trim(),
          phase.todayPlanTask?.classificationText || undefined,
          phase.todayPlanTask || undefined
        ),
      ],
      attentionGuardrail: null,
    });
  }

  const now = Date.now();
  const [daily, weekly] = await Promise.all([
    GoalPlanModel.findOne({ userId, scope: 'daily', periodKey: localDateKey(now) }).lean(),
    GoalPlanModel.findOne({ userId, scope: 'weekly', periodKey: weekStartKey(now) }).lean(),
  ]);
  const reminders = await getReminderTasks(userId, now);
  const remainingTasks = reminders.enabled
    ? reminders.tasks
    : activeTasks((daily?.tasks || []) as GoalTask[]);
  const remaining = remainingTasks.map((item) => item.text.trim());
  if (remaining.length) {
    const dayKey = localDateKey(now);
    return attachSupportProfiles(userId, {
      scope: 'daily',
      primaryGoal: remaining[0],
      dailyTasks: remaining,
      targets: remainingTasks.map((item) =>
        target(
          item.source === 'reminder' ? `reminder:${item.id}` : `daily:${dayKey}:${item.id}`,
          'daily',
          item.text.trim(),
          item.classificationText,
          {
            taskId: item.id,
            ...('listId' in item
              ? {
                  listId: String(item.listId),
                  listName: (item as import('../../../shared/reminders').ReminderTask).listName,
                  listContext: (item as import('../../../shared/reminders').ReminderTask)
                    .listFocusContext,
                }
              : {}),
          }
        )
      ),
      attentionGuardrail: null,
    });
  }
  const weeklyFocus = weekly?.focusText?.trim() || weekly?.text?.trim() || '';
  if (weeklyFocus) {
    const key = weekStartKey(now);
    return attachSupportProfiles(userId, {
      scope: 'weekly',
      primaryGoal: weeklyFocus,
      dailyTasks: [],
      targets: [target(`weekly:${key}`, 'weekly', weeklyFocus)],
      attentionGuardrail: weekly?.attentionGuardrail?.trim() || null,
    });
  }
  return {
    scope: 'none',
    primaryGoal: null,
    dailyTasks: [],
    targets: [],
    attentionGuardrail: null,
  };
}

export const goalPeriodFor = {
  dayKey: localDateKey,
  weekKey: weekStartKey,
  sortedTasks,
};

/** Freeze this before inference so delayed feedback never uses a different live task. */
export const snapshotGoalContext = (
  goals: EffectiveGoalContext
): ClassificationContextSnapshot => ({
  version: 2,
  scope: goals.scope,
  sessionId:
    goals.sessionId ||
    (goals.scope === 'daily'
      ? `daily:${localDateKey()}`
      : goals.scope === 'weekly'
        ? `weekly:${weekStartKey()}`
        : null),
  targets: (goals.targets || []).map((t) => ({
    ref: t.ref,
    taskKey: t.taskKey || fingerprintGoalText(t.text),
    text: t.text.slice(0, 500),
    classificationText: (t.classificationText || t.text).slice(0, 1800),
    listKey: t.listKey || null,
    listName: t.listName || null,
    listContext: t.listContext || null,
    supportingModes: t.supportProfile?.supportingModes || [],
    profileRevision: t.supportProfile?.revision || null,
  })),
});
