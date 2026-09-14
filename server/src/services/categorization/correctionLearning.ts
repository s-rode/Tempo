import crypto from 'crypto';
import type { ClassifierStrictness } from '../../../../shared/types';
import type { EffectiveGoalTarget } from '../goalPlans';
import { ClassifierFeedbackModel } from '../../models/classifierFeedback';
import type { PageActivityDescriptorData } from './pageDescriptorTypes';

export type LearnedState = 'focused' | 'distracted';

export interface LearningExampleForPrompt {
  id: string;
  state: LearnedState;
  toolLabel: string;
  pageKind: string | null;
  supportingMode: string | null;
  subjectCues: string[];
  expectedOutcome: string;
  supportingModes: string[];
  topicCues: string[];
}

export interface LearningExample extends LearningExampleForPrompt {
  toolKey: string;
  patternKey: string;
  categoryId: string;
  updatedAtMs: number;
}

const stopWords = new Set([
  'and',
  'app',
  'for',
  'focus',
  'in',
  'learn',
  'learning',
  'on',
  'prepare',
  'preparation',
  'review',
  'study',
  'the',
  'to',
  'use',
  'using',
  'with',
  'work',
]);

const tokens = (values: Array<string | null | undefined>): Set<string> =>
  new Set(
    values
      .join(' ')
      .normalize('NFKD')
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu)
      // Keep useful internal punctuation (for example C#), but punctuation at
      // a sentence boundary must not turn `exam.` into a different cue from
      // `exam`. Goal-support profiles commonly contain complete sentences.
      ?.map((value) => value.replace(/^[#.-]+|[#.-]+$/gu, '').replace(/(ies|ing|es|s)$/u, ''))
      .filter((value) => value.length >= 3 && !stopWords.has(value)) || []
  );

const boundedStrings = (values: unknown, max: number, length: number): string[] =>
  Array.isArray(values)
    ? values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.replace(/\s+/g, ' ').trim().slice(0, length))
        .filter(Boolean)
        .slice(0, max)
    : [];

export const goalProfileSnapshot = (target: EffectiveGoalTarget) => ({
  subjectCues:
    target.supportProfile?.subjectCues?.slice(0, 6) || [...tokens([target.text])].slice(0, 6),
  expectedOutcome: (target.supportProfile?.expectedOutcome || target.text).slice(0, 120),
  supportingModes: target.supportProfile?.supportingModes?.slice(0, 5) || [],
});

export const correctionLearningPatternKey = (input: {
  toolKey: string;
  state: LearnedState;
  pageKind: string | null;
  supportingMode: string | null;
  goal: ReturnType<typeof goalProfileSnapshot>;
}): string =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        toolKey: input.toolKey,
        state: input.state,
        pageKind: input.pageKind,
        supportingMode: input.supportingMode,
        subjectCues: [...input.goal.subjectCues].sort(),
        supportingModes: [...input.goal.supportingModes].sort(),
      })
    )
    .digest('hex');

export async function findLearningExamples(input: {
  userId: string;
  toolKey: string | null | undefined;
  descriptor: Pick<PageActivityDescriptorData, 'pageKind' | 'topicCues'>;
  enabled: boolean;
}): Promise<LearningExample[]> {
  if (!input.enabled || !input.toolKey) return [];
  const records = await ClassifierFeedbackModel.find({
    userId: input.userId,
    learningEligible: true,
    learningToolKey: input.toolKey,
  })
    .sort({ updatedAt: -1 })
    .limit(12)
    .lean();

  const clearlyOffGoalKinds = new Set(['social', 'entertainment', 'shopping', 'general_browsing']);
  return records
    .filter((record) => {
      // Unknown/native descriptors may still be compatible with a learned
      // study method. Clearly off-goal activity kinds never borrow focus from
      // a different learned work shape.
      if (!record.activityPageKind || input.descriptor.pageKind === 'unknown') return true;
      if (record.activityPageKind === input.descriptor.pageKind) return true;
      return !(
        clearlyOffGoalKinds.has(record.activityPageKind) ||
        clearlyOffGoalKinds.has(input.descriptor.pageKind)
      );
    })
    .map((record) => ({
      id: String(record._id),
      state: record.learnedState as LearnedState,
      toolKey: record.learningToolKey || '',
      toolLabel: record.learningToolLabel || 'Remembered tool',
      patternKey: record.learningPatternKey || String(record._id),
      pageKind: record.activityPageKind || null,
      supportingMode: record.activitySupportingMode || null,
      subjectCues: boundedStrings(record.goalSubjectCues, 6, 32),
      expectedOutcome: String(record.goalExpectedOutcome || '').slice(0, 120),
      supportingModes: boundedStrings(record.goalSupportingModes, 5, 40),
      topicCues: boundedStrings(record.activityTopicCues, 6, 32),
      categoryId: record.correctedCategoryId,
      updatedAtMs: record.updatedAt.getTime(),
    }));
}

/**
 * A small, deterministic safety check around the model's semantic similarity
 * judgement. It is deliberately based on user-corrected, derived data only.
 */
export const learningSimilarityScore = (
  example: LearningExample,
  target: EffectiveGoalTarget,
  descriptor: Pick<PageActivityDescriptorData, 'pageKind' | 'topicCues'>
): number => {
  const clearlyOffGoalKinds = new Set(['social', 'entertainment', 'shopping', 'general_browsing']);
  if (
    example.pageKind &&
    descriptor.pageKind !== 'unknown' &&
    example.pageKind !== descriptor.pageKind &&
    (clearlyOffGoalKinds.has(example.pageKind) || clearlyOffGoalKinds.has(descriptor.pageKind))
  )
    return 0;
  const exampleTokens = tokens([...example.subjectCues, example.expectedOutcome]);
  const targetSnapshot = goalProfileSnapshot(target);
  const targetTokens = tokens([...targetSnapshot.subjectCues, targetSnapshot.expectedOutcome]);
  const common = [...exampleTokens].filter((value) => targetTokens.has(value)).length;
  const cueCoverage = common / Math.max(1, Math.min(exampleTokens.size, targetTokens.size));
  const modeMatches = example.supportingMode
    ? targetSnapshot.supportingModes.includes(example.supportingMode as never)
    : false;
  const currentTopics = tokens(descriptor.topicCues);
  const topicOverlap = [...tokens(example.topicCues)].some((value) => currentTopics.has(value));
  return Math.min(1, cueCoverage * 0.65 + (modeMatches ? 0.3 : 0) + (topicOverlap ? 0.05 : 0));
};

export const learnedEvidenceThreshold = (strictness: ClassifierStrictness): number =>
  strictness === 'flexible' ? 0.5 : strictness === 'balanced' ? 0.7 : 0.85;

/**
 * Explicit feedback is a local, independently validated signal. The model can
 * still reason about ambiguous activity, but it must not be able to discard a
 * close correction simply by omitting its alias from a response. These quality
 * gates keep the three strictness modes meaningfully distinct:
 *
 * - Flexible accepts a close, compatible learned pattern.
 * - Balanced also needs a readable activity description.
 * - Strict needs strong current evidence in addition to a very close pattern.
 */
export const allowsLearnedEvidence = (input: {
  strictness: ClassifierStrictness;
  evidenceQuality: PageActivityDescriptorData['evidenceQuality'];
}): boolean => {
  if (input.strictness === 'flexible') return true;
  if (input.strictness === 'balanced') return input.evidenceQuality !== 'weak';
  return input.evidenceQuality === 'strong';
};

export const hasConflictingNegativeLearning = (input: {
  examples: LearningExample[];
  target: EffectiveGoalTarget;
  descriptor: Pick<PageActivityDescriptorData, 'pageKind' | 'topicCues'>;
  strictness: ClassifierStrictness;
}): boolean =>
  input.examples.some(
    (example) =>
      example.state === 'distracted' &&
      learningSimilarityScore(example, input.target, input.descriptor) >=
        learnedEvidenceThreshold(input.strictness)
  );

export interface LearnedFocusedMatch {
  example: LearningExample;
  target: EffectiveGoalTarget;
  score: number;
}

/**
 * Select the strongest local positive correction before asking the model to
 * relate the activity to a goal. This is deliberately deterministic: a saved
 * correction should help precisely when the user taught Tempo the same tool,
 * compatible activity shape, and a sufficiently similar active goal. A close
 * negative correction always wins and prevents an unsafe learned-focus reuse.
 */
export const selectLearnedFocusedMatch = (input: {
  examples: LearningExample[];
  targets: EffectiveGoalTarget[];
  descriptor: Pick<PageActivityDescriptorData, 'pageKind' | 'topicCues' | 'evidenceQuality'>;
  strictness: ClassifierStrictness;
}): LearnedFocusedMatch | null => {
  if (
    !allowsLearnedEvidence({
      strictness: input.strictness,
      evidenceQuality: input.descriptor.evidenceQuality,
    })
  )
    return null;

  const threshold = learnedEvidenceThreshold(input.strictness);
  const matches: LearnedFocusedMatch[] = [];
  for (const target of input.targets) {
    if (
      hasConflictingNegativeLearning({
        examples: input.examples,
        target,
        descriptor: input.descriptor,
        strictness: input.strictness,
      })
    ) {
      continue;
    }
    for (const example of input.examples) {
      if (example.state !== 'focused') continue;
      const score = learningSimilarityScore(example, target, input.descriptor);
      if (score >= threshold) matches.push({ example, target, score });
    }
  }

  // Stable ordering keeps task priority meaningful when two targets have an
  // equally strong learned match; recency breaks ties within the same target.
  matches.sort(
    (left, right) =>
      right.score - left.score ||
      input.targets.indexOf(left.target) - input.targets.indexOf(right.target) ||
      right.example.updatedAtMs - left.example.updatedAtMs
  );
  return matches[0] || null;
};
