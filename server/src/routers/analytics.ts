import { z } from 'zod';
import { averageComparableDaysByTime, averageMatchingWeekdayByTime, calculatePeriodAnalytics } from '../services/analytics';
import { analyticsInputsFor } from '../services/analyticsDataCache';
import { calculatePeriodInsights, type InsightRun } from '../services/insights';
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
      const [{ previous, events, categories }, history, runtime] = await Promise.all([
        analyticsInputsFor(userId, input.previousStartDateMs, input.endDateMs),
        FocusRunHistoryModel.find({ userId, 'run.startedAtMs': { $gte: input.startDateMs, $lt: input.endDateMs } })
          .select('run endedAtMs outcome')
          .lean(),
        FocusRuntimeModel.findOne({ userId }).select('run').lean(),
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
      });
    })
});
