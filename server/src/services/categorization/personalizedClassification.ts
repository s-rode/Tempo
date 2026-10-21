import { NavigationEpisodeModel } from '../../models/classificationEpisode';
export { NavigationEpisodeModel } from '../../models/classificationEpisode';
import type {
  Category,
  ClassifierStrictness,
  SemanticProposal,
  ActiveWindowDetails,
} from '../../../../shared/types';
import { snapshotGoalContext, type EffectiveGoalContext } from '../goalPlans';
import { localClassificationProvider } from './provider';
import {
  cancelPendingGoalSupportProfiles,
  ensureGoalSupportProfiles,
} from './goalSupportProfileScheduler';
import { readToolProfile, cancelToolProfiles, scheduleToolProfile } from './toolProfiles';
import { loadPreferences, migrateLegacyLearning } from './learningActions';
import { resolvePersonalizedPolicy } from './personalizedPolicy';
import { checkActivityHistory } from './history';
import type { CategorizationResult } from './categorizationService';
import type { LearningToolIdentity } from './activityIdentity';

export async function classifyPersonalized(input: {
  userId: string;
  activity: Pick<
    ActiveWindowDetails,
    'ownerName' | 'title' | 'type' | 'browser' | 'content' | 'siteHost' | 'contentSource'
  >;
  goals: EffectiveGoalContext;
  strictness: ClassifierStrictness;
  learningEnabled: boolean;
  tool: LearningToolIdentity | null;
  categories: Category[];
  activityKey: string;
  pageCorrectionKey: string | null;
  goalFingerprint: string;
  classificationFingerprint: string;
  startedAt: number;
}): Promise<CategorizationResult> {
  const { userId, activity, goals, tool } = input;
  const goalSnapshot = snapshotGoalContext(goals);
  cancelPendingGoalSupportProfiles(userId);
  cancelToolProfiles(userId);
  await migrateLegacyLearning(userId);
  const historical = await checkActivityHistory(userId, activity, input.classificationFingerprint);
  if (
    historical?.classificationBasis &&
    ['visible_relevance', 'visible_conflict'].includes(historical.classificationBasis)
  ) {
    return {
      ...historical,
      classificationStatus: 'history',
      activityKey: input.activityKey,
      pageCorrectionKey: input.pageCorrectionKey,
      categoryReasoning: historical.categoryReasoning || null,
      activityLabel: historical.activityLabel || activity.title,
      activitySummary: historical.activitySummary || null,
      nudgeTitle: historical.nudgeTitle || null,
      nudgeBody: historical.nudgeBody || null,
      goalContextFingerprint: input.goalFingerprint,
      classificationContextFingerprint: input.classificationFingerprint,
      goalRelation: historical.goalRelation || null,
      supportingMode: historical.supportingMode || null,
      classifierStrictness: input.strictness,
      goalSnapshot,
      learningToolKey: tool?.key,
      learningToolKind: tool?.kind,
      learningToolLabel: tool?.label,
      classificationLatencyMs: Math.round(performance.now() - input.startedAt),
    };
  }
  const [preferences, profile] = await Promise.all([
    tool && input.learningEnabled
      ? loadPreferences(userId, tool.key, input.strictness)
      : Promise.resolve([]),
    tool ? readToolProfile(tool.key) : Promise.resolve(null),
  ]);
  const remaining = Math.max(1, 10_000 - (performance.now() - input.startedAt));
  const response = await localClassificationProvider.decideActivity(
    goals,
    input.categories,
    activity,
    input.strictness,
    remaining,
    [],
    true
  );
  const decision = response.decision;
  const proposal: SemanticProposal | null = decision
    ? {
        state: decision.state,
        assessment: decision.assessment || 'opaque',
        relation: decision.relation,
        confidence: decision.confidence,
        matchedGoalRef: decision.matchedGoalRef,
        supportingMode: decision.supportingMode,
        evidenceAliases: decision.evidenceAliases,
      }
    : null;
  const currentTarget =
    goalSnapshot.targets.find((t) => t.ref === proposal?.matchedGoalRef) || goalSnapshot.targets[0];
  const episodeKey =
    tool && currentTarget
      ? `${tool.key}:${currentTarget.taskKey}:${goalSnapshot.sessionId || 'none'}`
      : null;
  const now = Date.now();
  let navigationAllowed = false,
    decisionExpiresAtMs: number | null = null;
  if (proposal?.supportingMode === 'resource_navigation' && episodeKey) {
    const episode = await NavigationEpisodeModel.findOneAndUpdate(
      { userId, key: episodeKey },
      { $setOnInsert: { userId, key: episodeKey, startedAtMs: now } },
      { upsert: true, new: true }
    ).lean();
    decisionExpiresAtMs = Number(episode?.startedAtMs || now) + 60_000;
    navigationAllowed = now < decisionExpiresAtMs;
  }
  const title = activity.title.trim().toLocaleLowerCase();
  const independentEvidence = Boolean(
    proposal?.evidenceAliases.some((alias) =>
      alias === 'E2'
        ? title && title !== activity.ownerName.trim().toLocaleLowerCase()
        : alias === 'E3' || alias === 'E4'
    )
  );
  const resolution = resolvePersonalizedPolicy({
    proposal,
    targets: goalSnapshot.targets,
    preferences,
    toolProfile: profile,
    strictness: input.strictness,
    independentEvidence,
    navigationAllowed,
  });
  if (resolution.basis === 'visible_relevance' && episodeKey)
    await NavigationEpisodeModel.updateOne(
      { userId, key: episodeKey },
      { $set: { startedAtMs: now } }
    );
  const category =
    resolution.state === 'uncertain'
      ? null
      : input.categories.find(
          (c) =>
            c.isProductive === (resolution.state === 'focused') &&
            c.name.toLowerCase() === (resolution.state === 'focused' ? 'work' : 'distraction')
        ) ||
        input.categories.find((c) => c.isProductive === (resolution.state === 'focused')) ||
        null;
  if (resolution.preference) decisionExpiresAtMs = resolution.preference.expiresAtMs;
  const reasons = {
    manual: 'Manually classified.',
    visible_relevance: 'Visible activity advances the active task.',
    visible_conflict: 'Visible activity concerns a different task.',
    task_preference: 'Matches your correction for this task.',
    list_preference: 'Matches your explicit corrections for similar work in this list.',
    tool_role: 'This specialized tool supports a method required by this task.',
    resource_navigation: 'Finding materials for the active task.',
    insufficient_evidence: 'Needs more context to establish task relevance.',
    policy_rejected: 'Evidence does not meet the selected policy.',
    technical_failure: 'Local AI could not complete the comparison.',
  };
  ensureGoalSupportProfiles(userId, goals);
  if (tool && !profile)
    scheduleToolProfile(userId, tool.key, tool.label, activity.siteHost || null);
  return {
    categoryId: category?._id || null,
    categoryReasoning: reasons[resolution.basis],
    classificationStatus: !proposal
      ? response.failureCode === 'timeout' || response.failureCode === 'ollama_http_error'
        ? 'ollama_unavailable'
        : 'invalid_response'
      : resolution.state === 'uncertain'
        ? 'insufficient_context'
        : resolution.preference || resolution.basis === 'tool_role'
          ? 'policy_override'
          : 'ollama',
    activityKey: input.activityKey,
    pageCorrectionKey: input.pageCorrectionKey,
    activityLabel:
      resolution.state === 'distracted'
        ? `Distracted by ${activity.ownerName}`
        : activity.title || activity.ownerName,
    activitySummary:
      resolution.state === 'distracted'
        ? `Off task: ${(resolution.target?.text || goals.primaryGoal || 'current task').slice(0, 90)}`
        : resolution.state === 'uncertain'
          ? reasons[resolution.basis]
          : null,
    nudgeTitle: null,
    nudgeBody: null,
    goalContextFingerprint: input.goalFingerprint,
    classificationContextFingerprint: input.classificationFingerprint,
    goalRelation:
      resolution.state === 'uncertain'
        ? 'insufficient'
        : resolution.state === 'distracted'
          ? 'none'
          : proposal?.relation === 'direct'
            ? 'direct'
            : 'supporting',
    supportingMode:
      resolution.state === 'focused'
        ? proposal?.supportingMode || resolution.preference?.supportingMode || null
        : null,
    classificationFailureCode: response.failureCode || null,
    classificationAttemptCount: response.attemptCount,
    classifierStrictness: input.strictness,
    goalSnapshot,
    classificationBasis: resolution.basis,
    semanticProposal: proposal,
    preferenceId: resolution.preference?.id || null,
    decisionExpiresAtMs,
    learningToolKey: tool?.key || null,
    learningToolKind: tool?.kind || null,
    learningToolLabel: tool?.label || null,
    decisionConfidence: proposal?.confidence || null,
    matchedGoalRef: resolution.target?.ref || null,
    evidenceQuality: proposal?.evidenceAliases.includes('E4')
      ? 'strong'
      : independentEvidence
        ? 'partial'
        : 'weak',
    classificationLatencyMs: Math.round(performance.now() - input.startedAt),
  };
}
