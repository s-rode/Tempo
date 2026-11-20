import { z } from 'zod';
import { ActiveWindowEventModel } from '../models/activeWindowEvent';
import { invalidateAnalyticsInputs } from './analyticsDataCache';
import { setSystemSuspension } from './focusRuntime';

export const systemBoundarySchema = z.object({
  captureId: z.string().uuid(),
  // 'stop' closes the last activity when Tempo quit or the Mac shut down. It is
  // stored like a sleep, so every reader ends the open interval there, but it
  // never suspends the live runtime: Tempo is running again when it arrives.
  kind: z.enum(['sleep', 'wake', 'lock', 'unlock', 'stop']),
  timestamp: z.number().finite().positive().max(8.64e15),
});

export async function persistSystemBoundary(userId: string, boundary: z.infer<typeof systemBoundarySchema>) {
  const names = { sleep: 'Sleep', wake: 'Wake', lock: 'Lock', unlock: 'Unlock', stop: 'Sleep' };
  const stored = boundary.kind === 'stop' ? 'sleep' : boundary.kind;
  const timestamp = Math.min(boundary.timestamp, Date.now());
  await ActiveWindowEventModel.updateOne(
    { userId, monitoringCaptureId: boundary.captureId },
    { $setOnInsert: {
      userId, monitoringCaptureId: boundary.captureId, timestamp,
      ownerName: `System ${names[boundary.kind]}`, type: 'system',
      title: boundary.kind === 'stop' ? 'Tempo was not running' : `System ${names[boundary.kind]}`,
      captureReason: `system_${stored}`,
      categoryId: null, classificationStatus: 'insufficient_context',
    } },
    { upsert: true }
  );
  invalidateAnalyticsInputs(userId);
  if (boundary.kind === 'stop') return;
  // A replay repairs accounting, but cannot pause a newer live activity/run.
  const newer = await ActiveWindowEventModel.exists({ userId, timestamp: { $gt: timestamp } });
  if (!newer) await setSystemSuspension(userId, boundary.kind, timestamp);
}
