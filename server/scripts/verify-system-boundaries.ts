import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { persistSystemBoundary } from '../src/services/systemBoundary';
import { ActiveWindowEventModel } from '../src/models/activeWindowEvent';
import { FocusRuntimeModel } from '../src/models/focusRuntime';
import { calculatePeriodAnalytics } from '../src/services/analytics';

const database = `tempo_sleep_test_${randomUUID().replaceAll('-', '')}`;
try {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`);
  await ActiveWindowEventModel.init();
  const userId = new mongoose.Types.ObjectId().toString();
  const start = Date.now() - 16 * 3600000;
  await ActiveWindowEventModel.create({ userId, ownerName: 'Test app', type: 'window', timestamp: start, categoryId: 'd' });
  const sleep = { captureId: randomUUID(), kind: 'sleep' as const, timestamp: start + 60000 };
  await persistSystemBoundary(userId, sleep);
  assert.equal((await FocusRuntimeModel.findOne({ userId }))?.systemSleeping, true);
  await persistSystemBoundary(userId, sleep);
  assert.equal(await ActiveWindowEventModel.countDocuments({ monitoringCaptureId: sleep.captureId }), 1);
  await persistSystemBoundary(userId, { captureId: randomUUID(), kind: 'wake', timestamp: start + 15 * 3600000 });
  assert.equal((await FocusRuntimeModel.findOne({ userId }))?.systemSleeping, false);
  const events = await ActiveWindowEventModel.find({ userId }).lean();
  const result = calculatePeriodAnalytics(events as any, [{ _id: 'd', isProductive: false, name: 'Distraction' }] as any, start, Date.now(), Date.now());
  assert.equal(result.totals.distractedMs, 60000);
  await persistSystemBoundary(userId, { captureId: randomUUID(), kind: 'sleep', timestamp: start + 120000 });
  assert.equal((await FocusRuntimeModel.findOne({ userId }))?.systemSleeping, false);
  // Quitting Tempo (or a shutdown) closes the last window like a sleep, but
  // never leaves the live runtime suspended once Tempo is running again.
  const quitUser = new mongoose.Types.ObjectId().toString();
  await ActiveWindowEventModel.create({ userId: quitUser, ownerName: 'Notes', type: 'window', timestamp: start, categoryId: 'w' });
  await persistSystemBoundary(quitUser, { captureId: randomUUID(), kind: 'stop', timestamp: start + 90000 });
  assert.notEqual((await FocusRuntimeModel.findOne({ userId: quitUser }))?.systemSleeping, true);
  const quitEvents = await ActiveWindowEventModel.find({ userId: quitUser }).lean();
  const quit = calculatePeriodAnalytics(quitEvents as any, [{ _id: 'w', isProductive: true, name: 'Work' }] as any, start, Date.now(), Date.now());
  assert.equal(quit.totals.focusedMs, 90000);
  console.log('PASS: durable boundary deduplication, fifteen-hour sleep exclusion, historical replay safety, quit closes the last window');
} finally {
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
