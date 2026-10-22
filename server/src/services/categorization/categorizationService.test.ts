import { beforeEach, describe, expect, jest, mock, test } from 'bun:test';
import type { ActiveWindowDetails } from '../../../../shared/types';

const activeEvents = { findOne: jest.fn() };
const categories = { find: jest.fn() };
const rules = { findOne: jest.fn() };
const provider = {
  decideActivity: jest.fn(),
  describePage: jest.fn(),
  decideRelation: jest.fn(),
  classify: jest.fn(),
};
const pageDescriptors = { findOne: jest.fn(), updateOne: jest.fn() };
const users = { findById: jest.fn() };
const feedback = { find: jest.fn() };
const supportProfiles = {
  cancelPendingGoalSupportProfiles: jest.fn(),
  ensureGoalSupportProfiles: jest.fn(),
};
const goalPlans = {
  resolveEffectiveGoalContext: jest.fn(),
  fingerprintEffectiveGoalContext: jest.fn(),
  fingerprintClassificationContext: jest.fn(),
};

mock.module('../../models/activeWindowEvent', () => ({ ActiveWindowEventModel: activeEvents }));
mock.module('../../models/category', () => ({ CategoryModel: categories }));
mock.module('../../models/activityCorrectionRule', () => ({ ActivityCorrectionRuleModel: rules }));
mock.module('../../models/pageActivityDescriptor', () => ({
  PageActivityDescriptorModel: pageDescriptors,
}));
mock.module('../../models/user', () => ({ User: users }));
mock.module('../../models/classifierFeedback', () => ({ ClassifierFeedbackModel: feedback }));
mock.module('./provider', () => ({ localClassificationProvider: provider }));
mock.module('../goalPlans', () => goalPlans);
mock.module('./goalSupportProfileScheduler', () => supportProfiles);

const { categorizeActivity, manualCorrectionPresentation } = await import(
  './categorizationService'
);
const userId = 'local-user';
const work = { _id: 'work', userId, name: 'Work', description: 'Goal work', isProductive: true };
const distraction = {
  _id: 'distraction',
  userId,
  name: 'Distraction',
  description: 'Off goal',
  isProductive: false,
};
const page = (
  ownerName: string,
  title: string
): Pick<
  ActiveWindowDetails,
  | 'ownerName'
  | 'title'
  | 'url'
  | 'siteHost'
  | 'content'
  | 'contentSource'
  | 'type'
  | 'browser'
  | 'pageCorrectionKey'
> => ({
  ownerName,
  title,
  url: null,
  siteHost: null,
  content: null,
  contentSource: 'title',
  type: 'window',
  browser: null,
  pageCorrectionKey: null,
});

describe('grounded semantic activity categorization', () => {
  test('bounds manual display labels for long lecture titles without changing the title', () => {
    const activity = page(
      'Firefox',
      'A long university lecture title and recording date '.repeat(5)
    );
    const original = activity.title;
    expect(manualCorrectionPresentation(work, activity).activityLabel?.length).toBe(60);
    expect(activity.title).toBe(original);
    expect(
      manualCorrectionPresentation(distraction, { ownerName: 'A'.repeat(80) }).activityLabel?.length
    ).toBe(60);
  });
  beforeEach(() => {
    delete process.env.TEMPO_CLASSIFIER_MODE;
    process.env.TEMPO_PERSONALIZED_CLASSIFIER = 'disabled';
    jest.clearAllMocks();
    rules.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    activeEvents.findOne.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(null),
    });
    categories.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([work, distraction]) });
    users.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          electronAppSettings: { classifierStrictness: 'flexible', learnFromCorrections: true },
          classificationLearningRevision: 0,
        }),
      }),
    });
    feedback.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      }),
    });
    goalPlans.resolveEffectiveGoalContext.mockResolvedValue({
      scope: 'daily',
      primaryGoal: 'Do AML flashcards',
      dailyTasks: ['Do AML flashcards'],
      targets: [
        {
          ref: 'daily:today:aml',
          scope: 'daily',
          text: 'Do AML flashcards',
          textFingerprint: 'goal',
          supportProfile: {
            subjectCues: ['advanced machine learning', 'flashcards'],
            expectedOutcome: 'Review Advanced Machine Learning flashcards.',
            supportingModes: ['study_notes_or_retrieval', 'read_reference'],
            revision: 'profile',
          },
        },
      ],
      attentionGuardrail: null,
    });
    goalPlans.fingerprintEffectiveGoalContext.mockReturnValue('goal-context');
    goalPlans.fingerprintClassificationContext.mockReturnValue('semantic-context');
    provider.decideActivity.mockResolvedValue({
      decision: {
        state: 'focused',
        relation: 'supporting',
        matchedGoalRef: 'daily:today:aml',
        supportingMode: 'study_notes_or_retrieval',
        confidence: 'high',
        categoryAlias: 'Work',
        evidenceAliases: ['E2', 'E4'],
        learningExampleId: null,
        learningSimilarity: 'none',
      },
      attemptCount: 1,
    });
  });

  test('classifies Firefox evidence with one goal-aware request', async () => {
    const result = await categorizeActivity(userId, {
      ...page('Firefox', 'ChatGPT - Lecture: Advanced Machine Learning'),
      type: 'browser',
      browser: 'firefox',
      siteHost: 'chatgpt.com',
      content: 'Explaining a question from an Advanced Machine Learning lecture.',
      contentSource: 'dom',
    });
    expect(result).toMatchObject({
      categoryId: 'work',
      goalRelation: 'supporting',
      classificationAttemptCount: 1,
      pageDescriptorRevision: null,
    });
    expect(provider.decideActivity).toHaveBeenCalledTimes(1);
    expect(provider.describePage).not.toHaveBeenCalled();
    expect(provider.decideRelation).not.toHaveBeenCalled();
  });

  test('never sends native application body content to classification', async () => {
    await categorizeActivity(userId, {
      ...page('RemNote', 'Flashcard Queue - Advanced Machine Learning'),
      content: 'private accessibility body text',
      contentSource: 'ocr',
    });
    expect(provider.decideActivity.mock.calls[0][2]).toMatchObject({
      ownerName: 'RemNote',
      title: 'Flashcard Queue - Advanced Machine Learning',
      content: null,
      contentSource: 'title',
      siteHost: null,
      url: null,
    });
  });

  test('rejects an ungrounded focused answer', async () => {
    provider.decideActivity.mockResolvedValue({
      decision: {
        state: 'focused',
        relation: 'supporting',
        matchedGoalRef: 'daily:today:aml',
        supportingMode: 'read_reference',
        confidence: 'high',
        categoryAlias: 'Work',
        evidenceAliases: [],
        learningExampleId: null,
        learningSimilarity: 'none',
      },
      attemptCount: 1,
    });
    expect(await categorizeActivity(userId, page('Mail', 'Inbox'))).toMatchObject({
      categoryId: 'distraction',
      goalRelation: 'none',
    });
  });

  test('keeps a valid low-confidence off-goal answer as distraction', async () => {
    provider.decideActivity.mockResolvedValue({
      decision: {
        state: 'distracted',
        relation: 'none',
        matchedGoalRef: null,
        supportingMode: null,
        confidence: 'low',
        categoryAlias: 'Distraction',
        evidenceAliases: ['E2'],
        learningExampleId: null,
        learningSimilarity: 'none',
      },
      attemptCount: 1,
    });
    expect(await categorizeActivity(userId, page('Mail', 'Inbox'))).toMatchObject({
      categoryId: 'distraction',
      classificationStatus: 'ollama',
      goalRelation: 'none',
    });
  });

  test('uses a close learned tool preference in Flexible mode', async () => {
    provider.decideActivity.mockResolvedValue({
      decision: {
        state: 'focused',
        relation: 'supporting',
        matchedGoalRef: 'daily:today:aml',
        supportingMode: 'study_notes_or_retrieval',
        confidence: 'medium',
        categoryAlias: 'Work',
        evidenceAliases: ['E1'],
        learningExampleId: 'learned-remnote',
        learningSimilarity: 'close',
      },
      attemptCount: 1,
    });
    expect(await categorizeActivity(userId, page('RemNote', 'Queue'))).toMatchObject({
      categoryId: 'work',
      classificationStatus: 'policy_override',
      learningExampleId: 'learned-remnote',
    });
  });

  test('keeps exhausted inference technical and uncertain', async () => {
    provider.decideActivity.mockResolvedValue({
      decision: null,
      failureCode: 'timeout',
      attemptCount: 1,
    });
    const result = await categorizeActivity(userId, page('Firefox', 'Unreadable'));
    expect(result.categoryId).toBeNull();
    expect(result.classificationStatus).toBe('ollama_unavailable');
  });

  test('uses a goal-scoped correction before any model work', async () => {
    rules.findOne
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue({ categoryId: work._id }) });
    const result = await categorizeActivity(userId, {
      ...page('Firefox', 'Graphing Calculator'),
      type: 'browser',
      browser: 'firefox',
      pageCorrectionKey: 'a'.repeat(64),
    });
    expect(result.classificationStatus).toBe('manual_rule');
    expect(provider.decideActivity).not.toHaveBeenCalled();
  });
});
