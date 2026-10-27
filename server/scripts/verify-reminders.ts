/** Isolated integration verification. Never connects to the user's Tempo DB. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { User } from '../src/models/user';
import { GoalPlanModel } from '../src/models/goalPlan';
import { FocusRuntimeModel, FocusRunHistoryModel } from '../src/models/focusRuntime';
import { ReminderIntegrationModel, ReminderMetadataModel } from '../src/models/reminder';
import { applyReminderSync, getReminderTasks } from '../src/services/reminders';
import {
  getDailyPlan,
  goalPeriodFor,
  resolveEffectiveGoalContext,
} from '../src/services/goalPlans';
import { remindersRouter } from '../src/routers/reminders';
import { focusRuntimeRouter } from '../src/routers/focusRuntime';
import { cancelPendingGoalSupportProfiles } from '../src/services/categorization/goalSupportProfileScheduler';
import { localClassificationProvider } from '../src/services/categorization/provider';

process.env.TEMPO_LOCAL_MODE = 'true';
localClassificationProvider.profileGoal = async () => null;
const databaseName = `tempo_reminders_test_${randomUUID().replaceAll('-', '')}`;
const userId = new mongoose.Types.ObjectId().toString();
const token = jwt.sign({ userId }, process.env.AUTH_SECRET || 'local-development-secret');
let succeeded = false;

try {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`, {
    serverSelectionTimeoutMS: 3000,
  });
  await Promise.all([
    User.init(),
    GoalPlanModel.init(),
    ReminderIntegrationModel.init(),
    ReminderMetadataModel.init(),
    FocusRuntimeModel.init(),
    FocusRunHistoryModel.init(),
  ]);
  await User.create({
    _id: userId,
    googleId: 'reminders-test',
    email: 'test@tempo.invalid',
    name: 'Test',
    goalPlanMigrationVersion: 2,
  });
  const manualId = randomUUID();
  await GoalPlanModel.create({
    userId,
    scope: 'daily',
    periodKey: goalPeriodFor.dayKey(),
    timeZone: 'Europe/Berlin',
    tasks: [{ id: manualId, text: 'Existing manual task', position: 0, completedAtMs: null }],
  });
  assert.equal((await getDailyPlan(userId)).tasks[0].id, manualId);
  const today = new Date();
  const item = {
    sourceId: 'opaque-apple-identifier',
    title: 'Lecture Week 2',
    listId: 'ml',
    due: { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() },
    completed: false,
  };
  const lists = [
    { id: 'ml', name: 'Machine Learning', accountName: 'Test' },
    { id: 'math', name: 'Mathematics', accountName: 'Test' },
  ];
  await applyReminderSync(userId, {
    enabled: true,
    permission: 'granted',
    snapshot: { lists, reminders: [item, item] },
  });
  // A successful heartbeat preserves freshness without rewriting Apple data,
  // touching metadata, or treating harmless EventKit ordering as a goal edit.
  const metadataBefore = await ReminderMetadataModel.find({ userId }).lean();
  const changed = await applyReminderSync(userId, {
    enabled: true, permission: 'granted',
    snapshot: { lists: [...lists].reverse(), reminders: [item] },
  });
  assert.equal(changed, false);
  assert.deepEqual(await ReminderMetadataModel.find({ userId }).lean(), metadataBefore);
  await ReminderIntegrationModel.updateOne({ userId }, { $set: { syncCalendarKey: 'previous-day' } });
  assert.equal(await applyReminderSync(userId, {
    enabled: true, permission: 'granted', snapshot: { lists, reminders: [item] },
  }), true, 'calendar/timezone changes still recompute due-date goal context');
  assert.equal(await applyReminderSync(userId, {
    enabled: true, permission: 'granted', error: 'fetch_failed',
  }), true, 'sync errors remain visible');
  assert.equal(await applyReminderSync(userId, {
    enabled: true, permission: 'granted', snapshot: { lists, reminders: [item] },
  }), true, 'successful recovery still refreshes context');
  const plan = await getDailyPlan(userId);
  assert.equal(plan.source, 'reminder');
  assert.equal(plan.tasks.length, 1);
  const taskId = plan.tasks[0].id;
  assert.notEqual(taskId, item.sourceId);
  const reminders = remindersRouter.createCaller({});
  await reminders.setTaskMetadata({ token, taskId, estimatedMinutes: 45 });
  await Promise.all([
    reminders.setListContext({
      token,
      listId: 'ml',
      focusContext: 'Watch ML lectures and create flashcards.',
    }),
    reminders.setListContext({
      token,
      listId: 'math',
      focusContext: 'Solve mathematics exercises.',
    }),
  ]);
  const status = await reminders.getStatus({ token });
  assert.equal(status.listContexts.ml, 'Watch ML lectures and create flashcards.');
  assert.equal(status.listContexts.math, 'Solve mathematics exercises.');
  assert.equal((await getDailyPlan(userId)).tasks[0].estimatedMinutes, 45);
  assert.match(
    (await resolveEffectiveGoalContext(userId)).targets![0].classificationText!,
    /flashcards/
  );

  const focus = focusRuntimeRouter.createCaller({});
  const started = await focus.startCustom({
    token,
    goalSource: { kind: 'reminder', taskId },
    durationMinutes: 45,
  });
  assert.equal(started.currentPhase.todayPlanTask.source, 'reminder');
  assert.equal(started.run.taskTarget.estimatedMinutes, 45);
  const runId = started.run.id;
  const startedAt = started.currentPhase.startedAtMs;
  await reminders.setTaskMetadata({
    token,
    taskId,
    focusContext: 'Review only existing Week 2 flashcards.',
  });
  const live = await FocusRuntimeModel.findOne({ userId }).lean();
  const phase = live!.run!.phases[0];
  assert.equal(phase.goal, item.title);
  assert.equal(phase.startedAtMs, startedAt);
  assert.equal(phase.goalHistory.length, 2);
  assert.match(phase.goalHistory[0].todayPlanTask!.classificationText!, /Watch ML/);
  assert.match(phase.goalHistory[1].todayPlanTask!.classificationText!, /Review only/);
  assert.equal(phase.goalHistory[1].todayPlanTask!.taskId, taskId);

  await applyReminderSync(userId, { enabled: true, permission: 'granted', error: 'fetch_failed' });
  assert.equal((await getDailyPlan(userId)).tasks.length, 1);
  await assert.rejects(
    applyReminderSync(userId, {
      enabled: true,
      permission: 'granted',
      snapshot: { lists: [], reminders: [item] },
    })
  );
  assert.equal((await getDailyPlan(userId)).tasks.length, 1);
  await applyReminderSync(userId, {
    enabled: true,
    permission: 'denied',
    error: 'permission_denied',
  });
  assert.equal((await getReminderTasks(userId)).canStart, false);
  assert.equal((await FocusRuntimeModel.findOne({ userId }).lean())!.run!.state, 'active');
  // Even an artificial ID collision must not let finishing focus complete a manual task.
  await GoalPlanModel.updateOne(
    { userId },
    { $push: { tasks: { id: taskId, text: 'Collision guard', position: 1, completedAtMs: null } } }
  );
  await applyReminderSync(userId, {
    enabled: true,
    permission: 'granted',
    snapshot: { lists, reminders: [] },
  });
  await focus.finishTaskSession({ token, runId });
  const manualPlan = await GoalPlanModel.findOne({ userId }).lean();
  assert.equal(manualPlan!.tasks.find((task) => task.id === taskId)!.completedAtMs, null);
  const history = await FocusRunHistoryModel.findOne({ userId, runId }).lean();
  assert.equal(history!.run!.taskTarget!.source, 'reminder');
  assert.equal(history!.run!.taskTarget!.estimatedMinutes, 45);
  assert.match(
    history!.run!.phases[0].goalHistory[0].todayPlanTask!.classificationText!,
    /Watch ML/
  );

  await applyReminderSync(userId, {
    enabled: true,
    permission: 'granted',
    snapshot: { lists, reminders: [{ ...item, title: 'Renamed lecture', listId: 'math' }] },
  });
  const renamed = (await getReminderTasks(userId)).tasks[0];
  assert.equal(renamed.id, taskId);
  assert.equal(renamed.estimatedMinutes, 45);
  assert.equal(renamed.customFocusContext, 'Review only existing Week 2 flashcards.');
  await applyReminderSync(userId, {
    enabled: true,
    permission: 'granted',
    snapshot: { lists, reminders: [{ ...item, sourceId: 'next-recurrence' }] },
  });
  assert.notEqual((await getReminderTasks(userId)).tasks[0].id, taskId);
  assert.equal((await getReminderTasks(userId)).tasks[0].estimatedMinutes, null);
  assert.equal(await ReminderMetadataModel.countDocuments({ userId }), 2);
  await applyReminderSync(userId, { enabled: false, permission: 'granted' });
  assert.equal((await getDailyPlan(userId)).tasks[0].id, manualId);
  assert.equal(await FocusRunHistoryModel.countDocuments({ userId }), 1);
  succeeded = true;
  console.log(
    'Reminders integration: persistence, identity, sync retention, context segments, read-only completion, and disconnect verified.'
  );
} finally {
  cancelPendingGoalSupportProfiles(userId);
  if (mongoose.connection.readyState === 1 && mongoose.connection.name === databaseName)
    await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  // Runtime deadlines are intentionally server-owned timers, so end this
  // isolated process after cleanup rather than waiting for a task deadline.
  if (succeeded) process.exit(0);
}
