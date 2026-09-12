import { describe, expect, test } from 'bun:test';
import type { EffectiveGoalTarget } from '../goalPlans';
import {
  hasConflictingNegativeLearning,
  learnedEvidenceThreshold,
  learningSimilarityScore,
  type LearningExample,
} from './correctionLearning';

const target = (text: string, cues: string[]): EffectiveGoalTarget => ({
  ref: `daily:${text}`,
  scope: 'daily',
  text,
  textFingerprint: text,
  supportProfile: {
    subjectCues: cues,
    expectedOutcome: text,
    supportingModes: ['study_notes_or_retrieval'],
    revision: 'test',
  },
});

const example = (state: 'focused' | 'distracted'): LearningExample => ({
  id: `example-${state}`,
  state,
  toolKey: 'opaque-remnote-key',
  toolLabel: 'RemNote',
  patternKey: `pattern-${state}`,
  pageKind: 'learning',
  supportingMode: 'study_notes_or_retrieval',
  subjectCues: ['flashcards', 'review'],
  expectedOutcome: 'Review flashcards for an exam.',
  supportingModes: ['study_notes_or_retrieval'],
  topicCues: ['flashcards'],
  categoryId: state === 'focused' ? 'work' : 'distraction',
  updatedAtMs: 1,
});

const descriptor = {
  pageKind: 'learning' as const,
  topicCues: ['flashcards'],
};

describe('correction learning safety policy', () => {
  test('treats a strongly similar flashcard goal as close enough in Flexible mode', () => {
    const score = learningSimilarityScore(
      example('focused'),
      target('review quant interview flashcards', ['flashcards', 'quant']),
      descriptor
    );
    expect(score).toBeGreaterThanOrEqual(learnedEvidenceThreshold('flexible'));
    expect(score).toBeLessThan(learnedEvidenceThreshold('strict'));
  });

  test('does not generalize a learned study tool to an unrelated goal', () => {
    const score = learningSimilarityScore(
      example('focused'),
      target('organize household finances', ['household', 'finances']),
      descriptor
    );
    expect(score).toBeLessThan(learnedEvidenceThreshold('flexible'));
  });

  test('a close explicit negative correction blocks learned focus', () => {
    const flashcardTarget = target('review quant interview flashcards', ['flashcards', 'quant']);
    expect(
      hasConflictingNegativeLearning({
        examples: [example('focused'), example('distracted')],
        target: flashcardTarget,
        descriptor,
        strictness: 'flexible',
      })
    ).toBe(true);
  });

  test('never compares corrections across incompatible visible activity kinds', () => {
    expect(
      learningSimilarityScore(example('focused'), target('review flashcards', ['flashcards']), {
        pageKind: 'social',
        topicCues: ['flashcards'],
      })
    ).toBe(0);
  });
});
