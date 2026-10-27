/** Disposable DB verification; never reads the user's history or Apple Reminders. */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { User } from '../src/models/user';
import { CategoryModel } from '../src/models/category';
import { FocusRuntimeModel } from '../src/models/focusRuntime';
import { ActiveWindowEventModel } from '../src/models/activeWindowEvent';
import { createCustomRun } from '../src/services/focusRuntime';
import { resolveGoalContext } from '../src/services/categorization/categorizationService';
import { prepareDistractionNotification } from '../src/services/categorization/distractionNudge';
import { beginEnrichmentCapture } from '../src/services/categorization/enrichmentScheduler';
import { cancelDistractionNudge } from '../src/services/categorization/distractionNudgeRequests';
import { localClassificationProvider } from '../src/services/categorization/provider';

process.env.TEMPO_LOCAL_MODE = 'true';
const database = `tempo_test_nudges_${randomUUID().replaceAll('-', '')}`;
const original = localClassificationProvider.distractionNudge;
let userId = '', calls = 0;
const copy = { title: 'Put the chat aside', body: 'Leave the messages for later and solve the next statistics exercise.' };
try {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`);
  const user = await User.create({ googleId: 'nudge-test', email: 'test@tempo.invalid', name: 'Test', goalPlanMigrationVersion: 2 });
  userId = String(user._id);
  const category = await CategoryModel.create({ userId, name: 'Distraction', color: '#ff0000', isProductive: false });
  await FocusRuntimeModel.create({ userId, run: createCustomRun('Solve the statistics exercise sheet', 30) });
  const context = await resolveGoalContext(userId);
  let timestamp = Date.now();
  const event = () => ActiveWindowEventModel.create({ userId, ownerName: 'WhatsApp', title: 'WhatsApp', type: 'window',
    timestamp: ++timestamp, categoryId: String(category._id), classificationStatus: 'history', goalContextFingerprint: context.fingerprint });
  localClassificationProvider.distractionNudge = async () => { calls++; return copy; };
  const first = await event();
  await ActiveWindowEventModel.updateOne({ _id: first._id }, { $set: {
    nudgeTitle: 'Close WhatsApp', nudgeBody: 'Close WhatsApp and return to the exercise sheet.',
  } });
  const results = await Promise.all([prepareDistractionNotification(userId, String(first._id)), prepareDistractionNotification(userId, String(first._id))]);
  assert.deepEqual(results, [{ copy }, { copy }]);
  assert.equal(calls, 1);
  assert.deepEqual(await prepareDistractionNotification(userId, String(first._id)), { copy });
  assert.equal(calls, 1, 'recurring reminders reuse persisted copy');
  const saved = await ActiveWindowEventModel.findById(first._id).lean();
  assert.equal(saved?.nudgeBody, copy.body);
  assert.equal(saved?.classificationStatus, 'history', 'copy never reclassifies history');
  const second = await event();
  localClassificationProvider.distractionNudge = async () => { calls++; return null; };
  assert.deepEqual(await prepareDistractionNotification(userId, String(second._id)), { copy: null });
  assert.deepEqual(await prepareDistractionNotification(userId, String(second._id)), { copy: null });
  assert.equal(calls, 2, 'failed inference is attempted once');
  assert.equal(await prepareDistractionNotification(userId, String(first._id)), null, 'old events are rejected');
  await User.updateOne({ _id: userId }, { $set: { 'electronAppSettings.showDistractionNotifications': false } });
  assert.equal(await prepareDistractionNotification(userId, String(second._id)), null, 'disabled notifications do no model work');
  await User.updateOne({ _id: userId }, { $set: { 'electronAppSettings.showDistractionNotifications': true } });
  await FocusRuntimeModel.updateOne({ userId }, { $set: { manualPauseUntilMs: Date.now() + 60_000 } });
  assert.equal(await prepareDistractionNotification(userId, String(second._id)), null, 'paused tracking cannot generate reminders');
  await FocusRuntimeModel.updateOne({ userId }, { $set: { manualPauseUntilMs: null } });

  for (const boundary of ['capture', 'goal'] as const) {
    const pendingEvent = await event();
    let release!: (value: typeof copy) => void;
    let started!: () => void;
    const ready = new Promise<void>(done => { started = done; });
    let signal!: AbortSignal;
    localClassificationProvider.distractionNudge = async (_goal, _activity, currentSignal) => {
      calls++; signal = currentSignal!; started();
      return new Promise<typeof copy>(done => { release = done; });
    };
    const pending = prepareDistractionNotification(userId, String(pendingEvent._id));
    await ready;
    if (boundary === 'capture') { beginEnrichmentCapture(userId); await event(); assert.equal(signal.aborted, true); }
    else await FocusRuntimeModel.updateOne({ userId }, { $set: { run: createCustomRun('Implement the new tests', 30) } });
    release(copy);
    assert.equal(await pending, null, 'late copy cannot cross an activity/goal boundary');
    assert.equal((await ActiveWindowEventModel.findById(pendingEvent._id).lean())?.nudgeBody, undefined);
  }
  console.log('PASS: custom copy persists and reuses; missing history copy generates once; failure, disable, pause, newer capture and goal changes are handled.');
} finally {
  cancelDistractionNudge(userId);
  localClassificationProvider.distractionNudge = original;
  if (mongoose.connection.db?.databaseName === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
