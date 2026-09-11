import { describe, expect, test } from 'bun:test';
import { validateFocusedEvidence } from './classificationEvidence';

const target = {
  ref: 'session:flashcards',
  scope: 'session' as const,
  text: 'review flashcards in RemNote',
  textFingerprint: 'goal',
  supportProfile: {
    subjectCues: ['flashcard', 'recall'],
    expectedOutcome: 'Review the planned flashcards.',
    supportingModes: ['study_notes_or_retrieval' as const, 'calculation_or_visualization' as const],
    revision: 'profile',
  },
};

const decision = {
  state: 'focused' as const,
  relation: 'supporting' as const,
  targetAlias: 'T1',
  matchedGoalRef: target.ref,
  supportingMode: 'study_notes_or_retrieval' as const,
  confidence: 'high' as const,
  categoryAlias: 'Work',
};

test('rejects a low-confidence generic supporting-method guess', () => {
  const result = validateFocusedEvidence({
    decision: { ...decision, confidence: 'low' },
    target,
    activity: { ownerName: 'Firefox', title: 'Raycast - Your shortcut to everything' },
    descriptor: {
      pageKind: 'general_browsing',
      actionLabel: 'searching for extensions',
      topicCues: ['extensions'],
      evidenceQuality: 'strong',
      source: 'ocr',
    },
  });
  expect(result.accepted).toBe(false);
  expect(result.observedSupportingMethod).toBe(false);
});

test('never turns a generated profile cue into direct evidence by itself', () => {
  const result = validateFocusedEvidence({
    decision: { ...decision, state: 'distracted', relation: 'none', supportingMode: null },
    target: {
      ...target,
      supportProfile: { ...target.supportProfile, subjectCues: ['extensions'] },
    },
    activity: { ownerName: 'Firefox', title: 'Extensions gallery' },
    descriptor: {
      pageKind: 'general_browsing',
      actionLabel: 'searching for extensions',
      topicCues: ['extensions'],
      evidenceQuality: 'strong',
      source: 'ocr',
    },
  });
  expect(result.accepted).toBe(false);
  expect(result.matchedTokens).toEqual([]);
});

test('recognizes a tool and subject explicitly named by the goal', () => {
  const result = validateFocusedEvidence({
    decision: { ...decision, state: 'distracted', relation: 'none', supportingMode: null },
    target,
    activity: { ownerName: 'RemNote', title: 'Flashcard Queue | Advanced Machine Learning' },
    descriptor: {
      pageKind: 'learning',
      actionLabel: 'reviewing flashcards',
      topicCues: ['machine learning'],
      evidenceQuality: 'strong',
      source: 'title',
    },
  });
  expect(result.accepted).toBe(true);
  expect(result.deterministicDirect).toBe(true);
  expect(result.explicitApplicationMatch).toBe(true);
});

test('accepts a high-confidence visibly compatible supporting tool', () => {
  const exerciseTarget = {
    ...target,
    text: 'solve the machine learning exercise sheet',
    supportProfile: {
      ...target.supportProfile,
      subjectCues: ['machine learning', 'exercises'],
    },
  };
  const result = validateFocusedEvidence({
    decision: {
      ...decision,
      matchedGoalRef: exerciseTarget.ref,
      supportingMode: 'calculation_or_visualization',
    },
    target: exerciseTarget,
    activity: { ownerName: 'Firefox', title: 'Graphing Calculator' },
    descriptor: {
      pageKind: 'problem_solving',
      actionLabel: 'graphing equations',
      topicCues: ['equations'],
      evidenceQuality: 'strong',
      source: 'dom',
    },
  });
  expect(result.accepted).toBe(true);
  expect(result.observedSupportingMethod).toBe(true);
});

describe('confidence boundary', () => {
  test('supporting work requires high confidence even with a visible method', () => {
    const result = validateFocusedEvidence({
      decision: { ...decision, confidence: 'medium' },
      target: {
        ...target,
        text: 'solve exercises',
        supportProfile: { ...target.supportProfile, subjectCues: [] },
      },
      activity: { ownerName: 'Firefox', title: 'Flashcard Tool' },
      descriptor: {
        pageKind: 'learning',
        actionLabel: 'reviewing flashcards',
        topicCues: [],
        evidenceQuality: 'strong',
        source: 'dom',
      },
    });
    expect(result.accepted).toBe(false);
  });
});
