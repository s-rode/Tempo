import { z } from 'zod';
import { ActiveWindowEventModel } from '../models/activeWindowEvent';
import { applyCalendarPause, getOrCreateRuntime, runtimeSnapshot, saveRuntime } from './focusRuntime';
import { invalidateAnalyticsInputs } from './analyticsDataCache';
import { cancelPendingEnrichment } from './categorization/enrichmentScheduler';
import { cancelPendingGoalSupportProfiles } from './categorization/goalSupportProfileScheduler';
export const calendarPauseSchema = z.object({untilMs: z.number().finite().positive().max(8.64e15).nullable(), eventIds: z.array(z.string().max(2048)).max(100), timestamp: z.number().finite().positive().max(8.64e15)});
export async function setCalendarPause(userId: string, input: z.infer<typeof calendarPauseSchema>) {
  const runtime = await getOrCreateRuntime(userId);
  const now = Math.min(input.timestamp, Date.now());
  const changed = applyCalendarPause(runtime, input.untilMs, now);
  runtime.calendarPauseEventIds = input.untilMs ? input.eventIds : [];
  await saveRuntime(runtime);
  if (changed) {
    cancelPendingEnrichment(userId); cancelPendingGoalSupportProfiles(userId);
    const ownerName = input.untilMs ? 'Calendar Pause' : 'Calendar Resume';
    await ActiveWindowEventModel.create({userId, timestamp: now, ownerName, title: ownerName, type: 'system', categoryId: null, classificationStatus: 'insufficient_context'});
    invalidateAnalyticsInputs(userId);
  }
  return runtimeSnapshot(runtime);
}
