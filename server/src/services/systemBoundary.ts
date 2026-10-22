import { z } from 'zod';
import { ActiveWindowEventModel } from '../models/activeWindowEvent';
import { invalidateAnalyticsInputs } from './analyticsDataCache';
import { setSystemSuspension } from './focusRuntime';

export const systemBoundarySchema = z.object({
  captureId: z.string().uuid(),
  kind: z.enum(['sleep', 'wake', 'lock', 'unlock']),
  timestamp: z.number().finite().positive().max(8.64e15),
});

export async function persistSystemBoundary(userId: string, boundary: z.infer<typeof systemBoundarySchema>) {
  const names = { sleep: 'Sleep', wake: 'Wake', lock: 'Lock', unlock: 'Unlock' };
  const timestamp = Math.min(boundary.timestamp, Date.now());
  await ActiveWindowEventModel.updateOne(
    { userId, monitoringCaptureId: boundary.captureId },
    { $setOnInsert: {
      userId, monitoringCaptureId: boundary.captureId, timestamp,
      ownerName: `System ${names[boundary.kind]}`, type: 'system',
      title: `System ${names[boundary.kind]}`, captureReason: `system_${boundary.kind}`,
      categoryId: null, classificationStatus: 'insufficient_context',
    } },
    { upsert: true }
  );
  invalidateAnalyticsInputs(userId);
  // A replay repairs accounting, but cannot pause a newer live activity/run.
  const newer = await ActiveWindowEventModel.exists({ userId, timestamp: { $gt: timestamp } });
  if (!newer) await setSystemSuspension(userId, boundary.kind, timestamp);
}
