/** Real router/Mongo integration in a unique disposable database. No production writes or model calls. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { User } from '../src/models/user';
import { CategoryModel } from '../src/models/category';
import { ActiveWindowEventModel } from '../src/models/activeWindowEvent';
import { FocusRuntimeModel, FocusRunHistoryModel } from '../src/models/focusRuntime';
import { GoalSupportProfileModel } from '../src/models/goalSupportProfile';
import { CorrectionActionModel } from '../src/models/correctionAction';
import { ClassifierFeedbackModel } from '../src/models/classifierFeedback';
import { createCustomRun } from '../src/services/focusRuntime';
import { resolveEffectiveGoalContext } from '../src/services/goalPlans';
import { activeWindowEventsRouter } from '../src/routers/activeWindowEvents';
import { localClassificationProvider } from '../src/services/categorization/provider';
import { cancelPendingGoalSupportProfiles } from '../src/services/categorization/goalSupportProfileScheduler';
import { cancelToolProfiles, ToolProfileModel } from '../src/services/categorization/toolProfiles';
import {
  migrateLegacyLearning,
  loadPreferences,
} from '../src/services/categorization/learningActions';
import { ClassificationReviewSampleModel } from '../src/routers/classificationLearning';
import { NavigationEpisodeModel } from '../src/services/categorization/personalizedClassification';
import { boundedActivityContent } from '../../electron-app/src/renderer/src/lib/activityCaptureState';

process.env.TEMPO_LOCAL_MODE = 'true';
delete process.env.TEMPO_PERSONALIZED_CLASSIFIER;
const database = `tempo_classifier_test_${randomUUID().replaceAll('-', '')}`;
const userId = new mongoose.Types.ObjectId().toString();
const token = jwt.sign({ userId }, process.env.AUTH_SECRET || 'local-development-secret');
const caller = activeWindowEventsRouter.createCaller({});
let assessment: 'relevant' | 'conflicting' | 'opaque' = 'opaque';
let mode = 'study_notes_or_retrieval';
let timeout = false;
localClassificationProvider.profileGoal = async () => null;
localClassificationProvider.profileTool = async () => null;
localClassificationProvider.enrich = async () => null;
localClassificationProvider.decideActivity = async (goals) => ({
  decision: timeout
    ? null
    : {
        state:
          assessment === 'relevant'
            ? 'focused'
            : assessment === 'conflicting'
              ? 'distracted'
              : 'uncertain',
        assessment,
        relation: assessment === 'relevant' ? 'supporting' : 'none',
        matchedGoalRef: goals.targets?.[0]?.ref || null,
        targetAlias: 'T1',
        supportingMode: mode,
        confidence: 'medium',
        categoryAlias: null,
        evidenceAliases: ['E2'],
        learningExampleId: null,
        learningSimilarity: 'none',
      },
  attemptCount: 1,
  ...(timeout ? { failureCode: 'timeout' as const } : {}),
});
const create = async (title = 'Study assistant') =>
  caller.create({
    token,
    ownerName: 'Study assistant',
    title,
    type: 'window',
    content: 'transient body must never persist',
    timestamp: Date.now(),
    monitoringCaptureId: randomUUID(),
  });
async function start(goal: string, taskId: string, listId = 'university') {
  const run = createCustomRun(goal, 25, Date.now(), {
    taskId,
    dateKey: '2026-10-21',
    source: 'reminder',
    listId,
    listName: 'University',
    listContext: 'Coursework',
    classificationText: `${goal}\nList: University\nCoursework`,
  });
  await FocusRuntimeModel.updateOne({ userId }, { $set: { run } }, { upsert: true });
  const context = await resolveEffectiveGoalContext(userId),
    target = context.targets![0];
  await GoalSupportProfileModel.updateOne(
    {
      userId,
      goalRef: `profile:${target.textFingerprint}`,
      goalTextFingerprint: target.textFingerprint,
      policyVersion: 2,
    },
    {
      $set: {
        subjectCues: ['coursework'],
        expectedOutcome: goal,
        supportingModes: ['study_notes_or_retrieval'],
        revision: 'integration',
      },
    },
    { upsert: true }
  );
  return run;
}
try {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, {
    serverSelectionTimeoutMS: 3000,
  });
  await User.create({
    _id: userId,
    name: 'Classifier Test',
    googleId: 'classifier-test',
    email: 'classifier@tempo.invalid',
    goalPlanMigrationVersion: 2,
    electronAppSettings: { classifierStrictness: 'balanced', learnFromCorrections: true },
  });
  const work = await CategoryModel.create({
    userId,
    name: 'Work',
    isProductive: true,
    color: '#00aa00',
  });
  const distraction = await CategoryModel.create({
    userId,
    name: 'Distraction',
    isProductive: false,
    color: '#aa0000',
  });
  const firstRun = await start('Review topology', randomUUID());
  const first = await create();
  assert.equal(first.categoryId, null);
  assert.equal(first.classificationBasis, 'insufficient_evidence');
  assert.equal(first.goalSnapshot?.targets[0].listName, 'University');
  const stored = await ActiveWindowEventModel.findById(first.eventId).lean();
  assert.equal((stored as any).content, undefined);
  assert.equal((stored as any).siteHost, undefined);
  // Change live goal before correcting: learning must retain the old context.
  const taskTwo = randomUUID();
  await start('Review graph theory', taskTwo);
  const actionId = randomUUID();
  const moved = await caller.recategorizeBlock({
    token,
    eventIds: [first.eventId!],
    newCategoryId: String(work._id),
    correctionActionId: actionId,
  });
  assert.equal(moved.learning.status, 'created');
  assert.equal(
    (await CorrectionActionModel.findOne({ userId }).lean())?.context.text,
    'Review topology'
  );
  await caller.recategorizeBlock({
    token,
    eventIds: [first.eventId!],
    newCategoryId: String(work._id),
    correctionActionId: actionId,
  });
  assert.equal(
    await CorrectionActionModel.countDocuments({ userId }),
    1,
    'retry must not strengthen learning'
  );
  for (let i = 0; i < 2; i++) {
    await start(i ? 'Review graph theory' : 'Review topology', i ? taskTwo : randomUUID());
    const a = await create(),
      b = await create();
    await caller.recategorizeBlock({
      token,
      eventIds: [a.eventId!, b.eventId!],
      newCategoryId: String(work._id),
      correctionActionId: randomUUID(),
    });
  }
  assert.equal(
    await CorrectionActionModel.countDocuments({ userId, superseded: false }),
    3,
    'a multi-event block is one action'
  );
  assert.equal(
    (await CorrectionActionModel.distinct('rootActionId', { userId, superseded: false })).length,
    3,
    'root action identities must survive persistence'
  );
  const heldOut = await start('Review measure theory', randomUUID());
  const learned = await create();
  assert.equal(learned.classificationBasis, 'list_preference');
  assert.equal(learned.categoryId, String(work._id));
  assessment = 'conflicting';
  const conflict = await create('Unrelated shopping');
  assert.equal(conflict.categoryId, String(distraction._id));
  assert.equal(conflict.classificationBasis, 'visible_conflict');
  assessment = 'opaque';
  await start('Prepare household finances', randomUUID(), 'household');
  assert.equal((await create()).categoryId, null, 'no list leakage');
  await start('Review measure theory', randomUUID());
  const reverse = await create();
  await caller.recategorizeBlock({
    token,
    eventIds: [reverse.eventId!],
    newCategoryId: String(distraction._id),
    correctionActionId: randomUUID(),
  });
  assert.equal(
    (await create()).categoryId,
    String(distraction._id),
    'negative task preference takes precedence'
  );
  await start('Review differential geometry', randomUUID());
  assert.equal((await create()).categoryId, null, 'negative suspends broad trust');
  const preferences = await caller.getScopedPreferences({ token });
  const broad = preferences.find((p) => p.scope === 'list');
  assert.equal(broad?.conflicted, true);
  await caller.manageScopedPreference({ token, preferenceId: broad!.id, state: 'active' });
  assert.equal((await create()).classificationBasis, 'list_preference');
  timeout = true;
  const failed = await create();
  assert.equal(failed.categoryId, null);
  assert.equal(failed.classificationBasis, 'technical_failure');
  assert.ok(!failed.activitySummary?.includes('Off goal'));
  timeout = false;
  assessment = 'relevant';
  mode = 'resource_navigation';
  const dashboard = await create('Course materials dashboard');
  assert.equal(dashboard.classificationBasis, 'resource_navigation');
  await NavigationEpisodeModel.updateMany(
    { userId },
    { $set: { startedAtMs: Date.now() - 61_000 } }
  );
  assert.equal(
    (await create('Course materials dashboard')).categoryId,
    null,
    'polling cannot renew navigation'
  );
  // A completed session exposes fixed samples; unsure supplies no training observation.
  mode = 'study_notes_or_retrieval';
  await FocusRuntimeModel.updateOne({ userId }, { $set: { run: heldOut } });
  const productive = await create('Measure theory lecture notes');
  await FocusRunHistoryModel.create({
    userId,
    runId: heldOut.id,
    run: { ...heldOut, state: 'completed' },
    endedAtMs: Date.now() + 1,
    outcome: 'completed',
  });
  const samples = await caller.getClassificationReviewSamples({ token, runId: heldOut.id });
  assert.ok(samples.length);
  assert.deepEqual(
    (await caller.getClassificationReviewSamples({ token, runId: heldOut.id })).map((s) => s.id),
    samples.map((s) => s.id)
  );
  const before = await CorrectionActionModel.countDocuments({ userId });
  await caller.submitClassificationReview({
    token,
    sampleId: samples[0].id,
    label: 'unsure',
    requestId: randomUUID(),
  });
  assert.equal(await CorrectionActionModel.countDocuments({ userId }), before);
  await caller.submitClassificationReview({
    token,
    sampleId: samples[0].id,
    label: 'distracted',
    requestId: randomUUID(),
  });
  assert.equal(await CorrectionActionModel.countDocuments({ userId }), before + 1);
  // A review confirmation can reverse a previous manual correction.
  await caller.submitClassificationReview({
    token,
    sampleId: samples[0].id,
    label: 'focused',
    requestId: randomUUID(),
  });
  assert.equal(await CorrectionActionModel.countDocuments({ userId }), before + 2);
  // Migration is repeatable and cannot infer a list from generated goal prose.
  await User.updateOne({ _id: userId }, { $set: { classificationLearningMigrationVersion: 0 } });

  // This process already migrated this user; use a separate legacy-only user to exercise the durable version marker.
  const legacyUser = await User.create({
    name: 'Legacy',
    googleId: 'legacy',
    email: 'legacy@tempo.invalid',
    goalPlanMigrationVersion: 2,
  });
  await ClassifierFeedbackModel.create({
    userId: String(legacyUser._id),
    sourceEventId: new mongoose.Types.ObjectId().toString(),
    originalState: 'distracted',
    correctedCategoryId: String(work._id),
    classifierVersion: 'semantic-grounded-v1',
    learningEligible: true,
    learningToolKey: 'legacy',
    learnedState: 'focused',
    goalExpectedOutcome: 'Study lecture. List: University',
  });
  await migrateLegacyLearning(String(legacyUser._id));
  await migrateLegacyLearning(String(legacyUser._id));
  const migrated = await CorrectionActionModel.find({ userId: String(legacyUser._id) }).lean();
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].context.listKey, null);
  await CorrectionActionModel.updateMany(
    { userId },
    { $set: { occurredAtMs: Date.now() - 91 * 86400000 } }
  );
  await start('Review complex analysis', randomUUID());
  assessment = 'opaque';
  assert.equal((await create()).categoryId, null, 'expired observations cannot supply trust');
  // Exercise the real Firefox transport boundary, not just the content helper.
  const longFirefox = await caller.create({
    token,
    ownerName: 'Firefox',
    title: 'Lecture notes',
    type: 'browser',
    browser: 'firefox',
    content: boundedActivityContent('lecture '.repeat(1000)),
    contentSource: 'ocr',
    contentCaptureStatus: 'captured',
    timestamp: Date.now(),
    monitoringCaptureId: randomUUID(),
  });
  assert.equal(longFirefox.ownerName, 'Firefox');
  assert.ok(
    longFirefox.eventId,
    'long OCR capture must persist instead of revealing the previous app'
  );
  // A single correction may span events with different previous categories.
  const mixedA = await create('Mixed original A');
  const mixedB = await create('Mixed original B');
  await ActiveWindowEventModel.updateOne(
    { _id: mixedB.eventId },
    { $set: { categoryId: String(distraction._id) } }
  );
  const mixedRoot = randomUUID();
  await caller.recategorizeBlock({
    token,
    eventIds: [mixedA.eventId!, mixedB.eventId!],
    newCategoryId: String(work._id),
    correctionActionId: mixedRoot,
  });
  const mixed = await CorrectionActionModel.findOne({ rootActionId: mixedRoot }).lean();
  assert.deepEqual(mixed?.originalDecisions?.map((d) => d.state).sort(), [
    'distracted',
    'uncertain',
  ]);
  assert.equal(
    (await ClassifierFeedbackModel.findOne({ sourceEventId: mixedB.eventId }).lean())
      ?.originalState,
    'distracted'
  );
  // Manual relevance controls must not depend on successful model inference/upload.
  const failedCaptureId = randomUUID();
  const correctionInput = {
    token,
    monitoringCaptureId: failedCaptureId,
    ownerName: 'Firefox',
    title: 'Lecture video with a detailed university course title and recording date '.repeat(3),
    type: 'browser' as const,
    browser: 'firefox' as const,
    pageCorrectionKey: 'a'.repeat(64),
    siteIdentity: 'b'.repeat(64),
  };
  const prepared = await caller.prepareCurrentActivityCorrection(correctionInput);
  const preparedAgain = await caller.prepareCurrentActivityCorrection(correctionInput);
  assert.equal(prepared.eventId, preparedAgain.eventId);
  assert.equal(prepared.categoryId, null);
  assert.equal(prepared.learningToolKey, correctionInput.siteIdentity);
  assert.equal(prepared.goalSnapshot?.targets[0].text, 'Review complex analysis');
  await caller.recategorizeBlock({
    token,
    eventIds: [prepared.eventId!],
    newCategoryId: String(work._id),
    rememberExactMatch: true,
    correctionActionId: randomUUID(),
  });
  const lateResponse = await caller.create({ ...correctionInput, timestamp: Date.now() });
  assert.equal(lateResponse.eventId, prepared.eventId);
  assert.equal(
    lateResponse.categoryId,
    String(work._id),
    'late inference cannot undo explicit feedback'
  );
  assert.ok((lateResponse.activityLabel?.length || 0) <= 60);
  assert.equal(lateResponse.title, correctionInput.title, 'full title is retained separately');
  for (let activation = 1; activation <= 3; activation++) {
    const revisit = await caller.reuseFirefoxNavigation({
      token,
      windowId: 123,
      title: `${correctionInput.title} ${activation}:00`,
      navigationFingerprint: String(activation).repeat(64),
      pageCorrectionKey: correctionInput.pageCorrectionKey,
      siteIdentity: correctionInput.siteIdentity,
      timestamp: Date.now(),
      captureReason: 'firefox_activation',
      monitoringCaptureId: randomUUID(),
    });
    assert.equal(revisit.reused, true);
    if (revisit.reused) {
      assert.equal(revisit.event.categoryId, String(work._id));
      assert.equal(revisit.event.classificationStatus, 'manual_rule');
      assert.equal(revisit.event.learningToolKey, correctionInput.siteIdentity);
      assert.ok((revisit.event.activityLabel?.length || 0) <= 60);
    }
  }
  await caller.recategorizeBlock({
    token,
    eventIds: [prepared.eventId!],
    newCategoryId: String(distraction._id),
    correctionActionId: randomUUID(),
  });
  assert.equal(
    (await caller.getClassificationEvent({ token, eventId: prepared.eventId! })).categoryId,
    String(distraction._id)
  );
  await start('An unrelated project', randomUUID(), 'another-list');
  const outsideScope = await caller.reuseFirefoxNavigation({
    token,
    windowId: 123,
    title: correctionInput.title,
    navigationFingerprint: '9'.repeat(64),
    pageCorrectionKey: correctionInput.pageCorrectionKey,
    siteIdentity: correctionInput.siteIdentity,
    timestamp: Date.now(),
    captureReason: 'firefox_activation',
    monitoringCaptureId: randomUUID(),
  });
  assert.equal(
    outsideScope.reused,
    false,
    'an explicit page correction must not escape its goal scope'
  );
  console.log(
    'PASS: historical corrections, deduplication, scope, conflicts, reinstatement, expiry, privacy, review, and migration'
  );
} finally {
  cancelPendingGoalSupportProfiles(userId);
  cancelToolProfiles(userId);
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
