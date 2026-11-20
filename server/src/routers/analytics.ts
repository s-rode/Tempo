import { z } from 'zod';
import { averageComparableDaysByTime, averageMatchingWeekdayByTime, calculatePeriodAnalytics } from '../services/analytics';
import { analyticsInputsFor } from '../services/analyticsDataCache';
import type { GoalPlannerInput } from '../services/goalInsights';
import { calculatePeriodInsights, type InsightRun } from '../services/insights';
import { plannerEnabled } from '../services/plannerState';
import { GoalPlanModel, type GoalTask } from '../models/goalPlan';
import { PlannerGoalModel } from '../models/plannerGoal';
import { FocusRunHistoryModel, FocusRuntimeModel } from '../models/focusRuntime';
import { publicProcedure, router } from '../trpc';
import { verifyToken } from './auth';

const periodInput = z.object({
  token: z.string(),
  startDateMs: z.number(),
  endDateMs: z.number(),
  comparisonAtMs: z.number().optional(),
  focusComparisonMode: z.enum(['all_active_days', 'same_day_type', 'same_weekday']).optional()
});

/** Goals and the task links that credit session time to them; null while the planner is off. */
const goalPlannerInputFor = async (userId: string): Promise<GoalPlannerInput | null> => {
  if (!(await plannerEnabled(userId))) return null;
  const [goals, plans] = await Promise.all([
    PlannerGoalModel.find({ userId }).sort({ position: 1 }).lean(),
    GoalPlanModel.find({ userId, scope: 'daily', 'tasks.goalId': { $type: 'string' } })
      .select('periodKey tasks.id tasks.text tasks.goalId tasks.position tasks.completedAtMs')
      .lean(),
  ]);
  const taskGoals: Record<string, string> = {};
  const open: Array<{ goalId: string; text: string; dayKey: string; position: number }> = [];
  for (const plan of plans as Array<{ periodKey: string; tasks?: GoalTask[] }>)
    for (const task of plan.tasks || []) {
      if (!task.goalId) continue;
      taskGoals[task.id] = task.goalId;
      if (task.completedAtMs === null) open.push({ goalId: task.goalId, text: task.text, dayKey: plan.periodKey, position: task.position });
    }
  const openTasks: Record<string, string[]> = {};
  for (const task of open.sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.position - b.position))
    (openTasks[task.goalId] ||= []).push(task.text);
  return {
    goals: (goals as any[]).map((goal) => ({
      id: goal.id,
      title: goal.title,
      color: goal.color,
      icon: goal.icon || '',
      completedAtMs: goal.completedAtMs ?? null,
      weeklyTargetMinutes: goal.weeklyTargetMinutes ?? null,
      createdAtMs: goal.createdAt ? new Date(goal.createdAt).getTime() : null,
    })),
    taskGoals,
    openTasks,
  };
};

export const analyticsRouter = router({
  getPeriod: publicProcedure.input(periodInput).query(async ({ input }) => {
    if (input.startDateMs >= input.endDateMs) throw new Error('startDateMs must be before endDateMs');
    const userId = verifyToken(input.token).userId;
    const comparisonStart = input.comparisonAtMs ? (() => {
      const start = new Date(input.comparisonAtMs);
      start.setDate(start.getDate() - 70);
      start.setHours(0, 0, 0, 0);
      return start.getTime();
    })() : input.startDateMs;
    const queryStart = Math.min(input.startDateMs, comparisonStart);
    const { previous, events, categories } = await analyticsInputsFor(userId, queryStart, input.endDateMs);
    const allEvents = (previous ? [previous, ...events] : events) as any[];
    const analytics = calculatePeriodAnalytics(allEvents, categories as any[], input.startDateMs, input.endDateMs);
    const usualByNow = input.comparisonAtMs
      ? averageMatchingWeekdayByTime({ events: allEvents, categories: categories as any[], comparisonAtMs: input.comparisonAtMs })
      : { focusedMs: null, sampleCount: 0 };
    const averageDayByNow = input.comparisonAtMs
      ? averageComparableDaysByTime({
          events: allEvents,
          categories: categories as any[],
          comparisonAtMs: input.comparisonAtMs,
          mode: input.focusComparisonMode || 'all_active_days'
        })
      : { focusedMs: null, sampleCount: 0 };
    return { ...analytics, usualByNow, averageDayByNow };
  }),
  /**
   * Behavioural insights for the Analysis page: focus blocks, golden hours,
   * distraction detours, session outcomes and a few evidence-based
   * suggestions, compared with the previous period up to the same point.
   */
  getInsights: publicProcedure
    .input(z.object({ token: z.string(), startDateMs: z.number(), endDateMs: z.number(), previousStartDateMs: z.number() }))
    .query(async ({ input }) => {
      if (input.startDateMs >= input.endDateMs) throw new Error('startDateMs must be before endDateMs');
      if (input.previousStartDateMs >= input.startDateMs) throw new Error('previousStartDateMs must be before startDateMs');
      const userId = verifyToken(input.token).userId;
      const [{ previous, events, categories }, history, runtime, planner] = await Promise.all([
        analyticsInputsFor(userId, input.previousStartDateMs, input.endDateMs),
        // From the previous period on, so goals can be compared with last time.
        FocusRunHistoryModel.find({ userId, 'run.startedAtMs': { $gte: input.previousStartDateMs, $lt: input.endDateMs } })
          .select('run endedAtMs outcome')
          .lean(),
        FocusRuntimeModel.findOne({ userId }).select('run').lean(),
        goalPlannerInputFor(userId),
      ]);
      const runs = history.map((entry) => ({ run: entry.run, endedAtMs: entry.endedAtMs, outcome: entry.outcome })) as unknown as InsightRun[];
      const activeRun = (runtime as { run?: InsightRun['run'] & { state?: string } } | null)?.run;
      if (activeRun?.state === 'active' && !runs.some((entry) => entry.run.id === activeRun.id)) {
        runs.push({ run: activeRun, endedAtMs: null, outcome: null });
      }
      return calculatePeriodInsights({
        events: (previous ? [previous, ...events] : events) as any[],
        categories: categories as any[],
        runs,
        startDateMs: input.startDateMs,
        endDateMs: input.endDateMs,
        previousStartDateMs: input.previousStartDateMs,
        planner,
      });
    })
});
