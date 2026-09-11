import { z } from 'zod';
import { averageComparableDaysByTime, averageMatchingWeekdayByTime, calculatePeriodAnalytics } from '../services/analytics';
import { analyticsInputsFor } from '../services/analyticsDataCache';
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
  })
});
