import {
  ActiveWindowDetails,
  Category as CategoryType,
  ClassifierStrictness,
} from '../../../../shared/types';
import { logToFile } from '../../lib/logger';
import { CategoryModel } from '../../models/category';
import { ActivityCorrectionRuleModel } from '../../models/activityCorrectionRule';
import {
  activityKeyFor,
  fingerprintCapturedContent,
  learningToolIdentityFor,
  pageCorrectionKeyFor,
} from './activityIdentity';
import { checkActivityHistory } from './history';
import { EffectiveGoalContext } from '../goalPlans';
import {
  fingerprintClassificationContext,
  fingerprintEffectiveGoalContext,
  resolveEffectiveGoalContext,
  snapshotGoalContext,
} from '../goalPlans';
import {
  cancelPendingGoalSupportProfiles,
  ensureGoalSupportProfiles,
} from './goalSupportProfileScheduler';
import {
  ClassificationFailureCode,
  ClassificationStatus,
  localClassificationProvider,
} from './provider';
import {
  fallbackPageDescriptor,
  descriptorRevision,
  persistPageDescriptor,
  readCachedPageDescriptor,
} from './pageDescriptors';
import { validateFocusedEvidence } from './classificationEvidence';
import {
  acceptsSemanticFocus,
  DEFAULT_CLASSIFIER_STRICTNESS,
  isClassifierStrictness,
} from './classificationPolicy';
import { User as UserModel } from '../../models/user';
import { selectLearnedFocusedMatch, findLearningExamples } from './correctionLearning';
import type { PersonalizedEventMetadata } from '../../../../shared/classification';
import { classifyPersonalized } from './personalizedClassification';

export interface CategorizationResult extends PersonalizedEventMetadata {
  categoryId: string | null;
  categoryReasoning: string | null;
  classificationStatus: ClassificationStatus;
  activityKey: string;
  pageCorrectionKey: string | null;
  activityLabel: string | null;
  activitySummary: string | null;
  nudgeTitle: string | null;
  nudgeBody: string | null;
  goalContextFingerprint: string | null;
  classificationContextFingerprint: string | null;
  goalRelation: 'direct' | 'supporting' | 'none' | 'insufficient' | null;
  supportingMode: string | null;
  classificationFailureCode?: ClassificationFailureCode | null;
  classificationAttemptCount?: number;
  pageDescriptorRevision?: string | null;
  pageKind?: string | null;
  pageDescriptorTopicCues?: string[] | null;
  evidenceQuality?: 'strong' | 'partial' | 'weak' | null;
  decisionConfidence?: 'high' | 'medium' | 'low' | null;
  matchedGoalRef?: string | null;
  classificationLatencyMs?: number | null;
  classifierStrictness: ClassifierStrictness;
  learningToolKey?: string | null;
  learningToolKind?: 'app' | 'site' | null;
  learningToolLabel?: string | null;
  learningExampleId?: string | null;
}

const distractionActivityLabel = (
  activeWindow: Pick<ActiveWindowDetails, 'ownerName'> & { title?: string | null }
): string =>
  `Distracted by ${activeWindow.ownerName?.trim() || activeWindow.title?.trim() || 'this activity'}`;

const currentGoal = (goals: EffectiveGoalContext): string | null =>
  goals.primaryGoal?.trim() || null;

const offGoalSummary = (goals: EffectiveGoalContext): string => {
  const goal = currentGoal(goals);
  if (!goal) return 'Does not support the current goal.';
  return `Off goal: ${goal.slice(0, 68).trim()}`;
};

type ManualRuleCategory = Pick<CategoryType, 'name' | 'isProductive'>;

/**
 * Rules remember a category, never old generated prose. Rebuild the visible
 * copy from the current activity so an earlier focus goal cannot leak into a
 * newly corrected event.
 */
export const manualCorrectionPresentation = (
  category: ManualRuleCategory,
  activeWindow: Pick<ActiveWindowDetails, 'ownerName'> & { title?: string | null }
): Pick<
  CategorizationResult,
  'categoryReasoning' | 'activityLabel' | 'activitySummary' | 'nudgeTitle' | 'nudgeBody'
> => ({
  categoryReasoning: `Manually marked as ${category.name}.`,
  activityLabel: (category.isProductive
    ? activeWindow.title?.trim() || activeWindow.ownerName
    : distractionActivityLabel(activeWindow)
  ).slice(0, 60),
  activitySummary: category.isProductive ? null : 'Manually marked as distraction.',
  nudgeTitle: null,
  nudgeBody: null,
});

export async function resolveGoalContext(userId: string): Promise<{
  goals: EffectiveGoalContext;
  fingerprint: string;
  classificationFingerprint: string;
  strictness: ClassifierStrictness;
  learnFromCorrections: boolean;
  learningRevision: number;
}> {
  const [goals, user] = await Promise.all([
    resolveEffectiveGoalContext(userId),
    UserModel.findById(userId)
      .select(
        'electronAppSettings.classifierStrictness electronAppSettings.learnFromCorrections classificationLearningRevision'
      )
      .lean(),
  ]);
  const strictness = isClassifierStrictness(user?.electronAppSettings?.classifierStrictness)
    ? user.electronAppSettings.classifierStrictness
    : DEFAULT_CLASSIFIER_STRICTNESS;
  const learnFromCorrections = user?.electronAppSettings?.learnFromCorrections !== false;
  const learningRevision = Math.max(0, Number(user?.classificationLearningRevision) || 0);
  return {
    goals,
    fingerprint: fingerprintEffectiveGoalContext(goals),
    classificationFingerprint: fingerprintClassificationContext(
      goals,
      strictness,
      learningRevision
    ),
    strictness,
    learnFromCorrections,
    learningRevision,
  };
}

export async function categorizeActivity(
  userId: string,
  activeWindow: Pick<
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
  >
): Promise<CategorizationResult> {
  const classificationStartedAt = performance.now();
  // Captured page text is intentionally transient. Never add activeWindow.content to logs.
  await logToFile('categorizeActivity called', {
    userId,
    ownerName: activeWindow.ownerName,
    type: activeWindow.type,
    browser: activeWindow.browser,
    hasContent: Boolean(activeWindow.content?.trim()),
  });
  // Firefox is the only application whose page body may reach the semantic
  // classifier. Native apps and other browsers remain app-and-title only.
  const classificationWindow =
    activeWindow.browser === 'firefox'
      ? activeWindow
      : {
          ...activeWindow,
          url: null,
          siteHost: null,
          content: null,
          contentSource: 'title' as const,
        };
  const legacyContentFingerprint = fingerprintCapturedContent(activeWindow.content);
  const legacyActivityKey = activityKeyFor(activeWindow, legacyContentFingerprint);
  const contentFingerprint = fingerprintCapturedContent(classificationWindow.content);
  const activityKey = activityKeyFor(classificationWindow, contentFingerprint);
  const pageCorrectionKey = pageCorrectionKeyFor(activeWindow);
  const learningTool = learningToolIdentityFor(activeWindow);

  const {
    goals: userGoals,
    fingerprint: goalContextFingerprint,
    classificationFingerprint,
    strictness,
    learnFromCorrections,
  } = await resolveGoalContext(userId);

  const rawUserCategories = await CategoryModel.find({ userId }).lean();
  const userCategories: CategoryType[] = rawUserCategories.map((cat) => ({
    ...cat,
    _id: cat._id.toString(),
    userId: cat.userId.toString(),
  }));

  if (!userCategories || userCategories.length === 0) {
    console.warn(
      '[CategorizationService] No categories are defined. Cannot categorize.'
    );
    return {
      goalSnapshot: snapshotGoalContext(userGoals),
      categoryId: null,
      categoryReasoning: null,
      classificationStatus: 'invalid_response',
      activityKey,
      pageCorrectionKey,
      activityLabel: activeWindow.title || activeWindow.ownerName,
      activitySummary: null,
      nudgeTitle: null,
      nudgeBody: null,
      goalContextFingerprint,
      classificationContextFingerprint: classificationFingerprint,
      goalRelation: null,
      supportingMode: null,
      classificationFailureCode: null,
      classificationAttemptCount: 0,
      classifierStrictness: strictness,
      learningToolKey: learningTool?.key || null,
      learningToolKind: learningTool?.kind || null,
      learningToolLabel: learningTool?.label || null,
    };
  }

  // 1. Exact local corrections are retained for compatibility. A stable page
  // correction is the safe fallback for browser revisits whose OCR/title has
  // legitimately changed, always within the same effective goal context.
  let correctionRule = await ActivityCorrectionRuleModel.findOne({
    userId,
    activityKey,
    goalContextFingerprint,
  }).lean();
  if (!correctionRule && legacyActivityKey !== activityKey) {
    correctionRule = await ActivityCorrectionRuleModel.findOne({
      userId,
      activityKey: legacyActivityKey,
      goalContextFingerprint,
    }).lean();
  }
  if (!correctionRule && pageCorrectionKey) {
    correctionRule = await ActivityCorrectionRuleModel.findOne({
      userId,
      pageCorrectionKey,
      goalContextFingerprint,
    }).lean();
  }
  const correctedCategory = correctionRule
    ? userCategories.find((category) => category._id === correctionRule.categoryId)
    : null;
  if (correctionRule && correctedCategory) {
    const presentation = manualCorrectionPresentation(correctedCategory, activeWindow);
    return {
      goalSnapshot: snapshotGoalContext(userGoals),
      categoryId: correctedCategory._id,
      categoryReasoning: presentation.categoryReasoning,
      classificationStatus: 'manual_rule',
      classificationBasis: 'manual',
      activityKey,
      pageCorrectionKey,
      activityLabel: presentation.activityLabel,
      activitySummary: presentation.activitySummary,
      nudgeTitle: presentation.nudgeTitle,
      nudgeBody: presentation.nudgeBody,
      goalContextFingerprint,
      classificationContextFingerprint: classificationFingerprint,
      goalRelation: null,
      supportingMode: null,
      classificationFailureCode: null,
      classificationAttemptCount: 0,
      classifierStrictness: strictness,
      learningToolKey: learningTool?.key || null,
      learningToolKind: learningTool?.kind || null,
      learningToolLabel: learningTool?.label || null,
    };
  }

  if (
    process.env.TEMPO_PERSONALIZED_CLASSIFIER !== 'disabled' &&
    !process.env.TEMPO_CLASSIFIER_MODE
  ) {
    return classifyPersonalized({
      userId,
      activity: classificationWindow,
      goals: userGoals,
      strictness,
      learningEnabled: learnFromCorrections,
      tool: learningTool,
      categories: userCategories,
      activityKey,
      pageCorrectionKey,
      goalFingerprint: goalContextFingerprint,
      classificationFingerprint,
      startedAt: classificationStartedAt,
    });
  }

  // 2. History Check
  const historical = await checkActivityHistory(
    userId,
    classificationWindow,
    classificationFingerprint
  );
  if (historical) {
    return {
      goalSnapshot: snapshotGoalContext(userGoals),
      categoryId: historical.categoryId,
      categoryReasoning: historical.categoryReasoning || null,
      classificationStatus: 'history',
      activityKey,
      pageCorrectionKey,
      activityLabel: historical.activityLabel || activeWindow.title || activeWindow.ownerName,
      activitySummary: historical.activitySummary || null,
      nudgeTitle: historical.nudgeTitle || null,
      nudgeBody: historical.nudgeBody || null,
      goalContextFingerprint,
      classificationContextFingerprint: classificationFingerprint,
      goalRelation: historical.goalRelation || null,
      supportingMode: historical.supportingMode || null,
      pageDescriptorRevision: historical.pageDescriptorRevision || null,
      pageKind: historical.pageKind || null,
      evidenceQuality: historical.evidenceQuality || null,
      decisionConfidence: historical.decisionConfidence || null,
      matchedGoalRef: historical.matchedGoalRef || null,
      classificationLatencyMs: Math.round(performance.now() - classificationStartedAt),
      classifierStrictness: strictness,
      learningToolKey: learningTool?.key || null,
      learningToolKind: learningTool?.kind || null,
      learningToolLabel: learningTool?.label || null,
    };
  }

  // 3. Interpret what is visibly happening without exposing the goal. A
  // descriptor is reusable across goals and contains no URL, hostname, OCR,
  // DOM text, prompt, or raw model output.
  const productiveCategory =
    userCategories.find(
      (category) => category.isProductive && category.name.trim().toLowerCase() === 'work'
    ) || userCategories.find((category) => category.isProductive);
  const distractionCategory =
    userCategories.find(
      (category) =>
        category.isProductive === false && category.name.trim().toLowerCase() === 'distraction'
    ) || userCategories.find((category) => category.isProductive === false);
  const categoryNamesForLLM = userCategories.map((c) => ({
    name: c.name,
    description: c.description,
    isProductive: c.isProductive,
  }));

  // Internal one-release safety valve. It is deliberately not user-facing
  // and can be removed after the factored classifier has enough feedback.
  if (process.env.TEMPO_CLASSIFIER_MODE === 'legacy') {
    cancelPendingGoalSupportProfiles(userId);
    const legacy = await localClassificationProvider.classify(
      userGoals,
      categoryNamesForLLM,
      activeWindow
    );
    const chosen = legacy.choice?.chosenCategoryName
      ? userCategories.find(
          (category) =>
            category.name.toLocaleLowerCase() ===
            legacy.choice?.chosenCategoryName?.toLocaleLowerCase()
        )
      : null;
    return {
      goalSnapshot: snapshotGoalContext(userGoals),
      categoryId: chosen?._id || null,
      categoryReasoning: chosen
        ? chosen.isProductive
          ? 'Legacy classifier found a goal connection.'
          : 'Legacy classifier found off-goal activity.'
        : 'Legacy classifier could not decide.',
      classificationStatus: legacy.status,
      activityKey,
      pageCorrectionKey,
      activityLabel:
        chosen?.isProductive === false
          ? distractionActivityLabel(activeWindow)
          : activeWindow.title || activeWindow.ownerName,
      activitySummary: chosen?.isProductive === false ? offGoalSummary(userGoals) : null,
      nudgeTitle: null,
      nudgeBody: null,
      goalContextFingerprint,
      classificationContextFingerprint: classificationFingerprint,
      goalRelation: legacy.choice?.goalRelation || null,
      supportingMode: legacy.choice?.supportingMode || null,
      classificationFailureCode: legacy.failureCode || null,
      classificationAttemptCount: legacy.attemptCount,
      classificationLatencyMs: Math.round(performance.now() - classificationStartedAt),
      classifierStrictness: strictness,
      learningToolKey: learningTool?.key || null,
      learningToolKind: learningTool?.kind || null,
      learningToolLabel: learningTool?.label || null,
    };
  }

  if (process.env.TEMPO_CLASSIFIER_MODE === 'factored') {
    cancelPendingGoalSupportProfiles(userId);
    const deadlineAt = Date.now() + 10_000;
    let descriptor = await readCachedPageDescriptor(userId, activityKey);
    const descriptorWasCached = Boolean(descriptor);
    let descriptorFailure: ClassificationFailureCode | undefined;
    if (!descriptor) {
      const source =
        activeWindow.contentSource === 'dom' || activeWindow.contentSource === 'ocr'
          ? activeWindow.contentSource
          : 'title';
      const interpreted = await localClassificationProvider.describePage(
        activeWindow,
        source,
        Math.min(5_000, Math.max(500, deadlineAt - Date.now()))
      );
      descriptorFailure = interpreted.failureCode;
      if (interpreted.descriptor) {
        descriptor = await persistPageDescriptor(userId, activityKey, interpreted.descriptor);
      } else {
        const fallback = fallbackPageDescriptor(activeWindow);
        descriptor = { ...fallback, revision: descriptorRevision(fallback) };
      }
    }

    // 4. Compare only the bounded descriptor with the active plan. A valid
    // reply always resolves to Focused or Distracted; Uncertain is technical.
    const learningExamples = await findLearningExamples({
      userId,
      toolKey: learningTool?.key,
      descriptor,
      enabled: learnFromCorrections,
    });
    const relationResult = await localClassificationProvider.decideRelation(
      userGoals,
      categoryNamesForLLM,
      descriptor,
      activeWindow,
      Math.max(500, deadlineAt - Date.now()),
      learningExamples.slice(0, 3)
    );
    const decision = relationResult.decision;
    const proposedTarget = decision?.matchedGoalRef
      ? (userGoals.targets || []).find((target) => target.ref === decision.matchedGoalRef) || null
      : null;
    const activeTargets = (userGoals.targets || []).filter(
      (target) => target.scope === userGoals.scope
    );
    const candidates = proposedTarget
      ? [proposedTarget, ...activeTargets.filter((target) => target.ref !== proposedTarget.ref)]
      : activeTargets;
    const evaluatedCandidates = candidates.map((target) => ({
      target,
      evidence: validateFocusedEvidence({
        decision,
        target,
        activity: activeWindow,
        descriptor,
        strictness,
      }),
    }));
    // Explicit corrections are a local source of evidence. Do not require the
    // model—which may be repeating the original mistake—to nominate L1 before a
    // close, compatible correction can help. The model still wins whenever it
    // supplies independently accepted direct/supporting evidence.
    const learnedMatch = selectLearnedFocusedMatch({
      examples: learningExamples,
      targets: activeTargets,
      descriptor,
      strictness,
    });
    const acceptedModelCandidate =
      evaluatedCandidates.find(
        ({ target, evidence }) => target.ref === proposedTarget?.ref && evidence.accepted
      ) ||
      evaluatedCandidates
        .filter(({ evidence }) => evidence.deterministicDirect)
        .sort((left, right) => {
          if (left.evidence.explicitApplicationMatch !== right.evidence.explicitApplicationMatch)
            return left.evidence.explicitApplicationMatch ? -1 : 1;
          return right.evidence.matchedTokens.length - left.evidence.matchedTokens.length;
        })[0] ||
      null;
    const learnedEvidenceAccepted = Boolean(!acceptedModelCandidate && learnedMatch);
    const acceptedCandidate =
      acceptedModelCandidate ||
      (learnedMatch
        ? {
            target: learnedMatch.target,
            evidence: {
              accepted: true,
              deterministicDirect: false,
              matchedTokens: [],
              explicitApplicationMatch: false,
              observedSupportingMethod: Boolean(learnedMatch.example.supportingMode),
            },
          }
        : null);
    const acceptedFocused = Boolean(acceptedCandidate);
    const deterministicDirect = Boolean(acceptedCandidate?.evidence.deterministicDirect);
    const matchedTarget = acceptedCandidate?.target || null;
    const semanticCategory = acceptedFocused ? productiveCategory : distractionCategory;
    const categoryAlias = decision?.categoryAlias?.trim().toLocaleLowerCase();
    const aliasCategory = categoryAlias
      ? userCategories.find(
          (category) =>
            category.name.trim().toLocaleLowerCase() === categoryAlias &&
            category.isProductive === Boolean(acceptedFocused)
        )
      : null;
    const determinedCategory = aliasCategory || semanticCategory || null;
    const technicalFailure = !decision && !acceptedFocused;
    const resolvedFailure = relationResult.failureCode || descriptorFailure || null;
    const finalRelation = acceptedFocused
      ? deterministicDirect
        ? 'direct'
        : learnedEvidenceAccepted
          ? 'supporting'
          : decision?.relation || 'direct'
      : decision
        ? 'none'
        : null;
    const categoryReasoning = technicalFailure
      ? 'Local AI could not complete the comparison.'
      : acceptedFocused
        ? learnedEvidenceAccepted
          ? 'Matches a similar correction for the current goal.'
          : finalRelation === 'supporting'
            ? `Supports the current target through ${String(decision?.supportingMode).replace(/_/g, ' ')}.`
            : deterministicDirect
              ? 'Visible app or topic evidence directly matches the current target.'
              : 'Directly advances the current target.'
        : 'No visible connection to the current target.';
    const activityLabel = acceptedFocused
      ? descriptor.actionLabel || activeWindow.title || activeWindow.ownerName
      : distractionActivityLabel(activeWindow);
    const activitySummary = acceptedFocused ? null : offGoalSummary(userGoals);

    // Profile generation begins only after the current core decision is done.
    // It is best effort and never retains this activity's captured content.
    ensureGoalSupportProfiles(userId, userGoals);

    return {
      goalSnapshot: snapshotGoalContext(userGoals),
      categoryId: technicalFailure ? null : determinedCategory?._id || null,
      categoryReasoning,
      classificationStatus: technicalFailure
        ? resolvedFailure === 'timeout' || resolvedFailure === 'ollama_http_error'
          ? 'ollama_unavailable'
          : 'invalid_response'
        : deterministicDirect
          ? 'deterministic_direct'
          : learnedEvidenceAccepted
            ? 'policy_override'
            : 'ollama',
      activityKey,
      pageCorrectionKey,
      activityLabel,
      activitySummary,
      nudgeTitle: null,
      nudgeBody: null,
      goalContextFingerprint,
      classificationContextFingerprint: classificationFingerprint,
      goalRelation: finalRelation,
      supportingMode:
        finalRelation === 'supporting'
          ? learnedEvidenceAccepted
            ? learnedMatch?.example.supportingMode || null
            : decision?.supportingMode || null
          : null,
      classificationFailureCode: technicalFailure ? resolvedFailure : null,
      classificationAttemptCount: relationResult.attemptCount + (descriptorWasCached ? 0 : 1),
      pageDescriptorRevision: descriptor.revision,
      pageKind: descriptor.pageKind,
      pageDescriptorTopicCues: descriptor.topicCues.slice(0, 6),
      evidenceQuality: descriptor.evidenceQuality,
      decisionConfidence: deterministicDirect ? 'high' : decision?.confidence || null,
      matchedGoalRef: acceptedFocused ? matchedTarget?.ref || null : null,
      classificationLatencyMs: Math.round(performance.now() - classificationStartedAt),
      classifierStrictness: strictness,
      learningToolKey: learningTool?.key || null,
      learningToolKind: learningTool?.kind || null,
      learningToolLabel: learningTool?.label || null,
      learningExampleId: learnedEvidenceAccepted ? learnedMatch?.example.id || null : null,
    };
  }

  // Default semantic-v1 path: one goal-aware request over original transient
  // evidence. The factored descriptor pipeline above remains available for a
  // one-release internal rollback, but no longer writes in normal operation.
  cancelPendingGoalSupportProfiles(userId);
  const learningExamples = await findLearningExamples({
    userId,
    toolKey: learningTool?.key,
    descriptor: null,
    enabled: learnFromCorrections,
  });
  const semantic = await localClassificationProvider.decideActivity(
    userGoals,
    categoryNamesForLLM,
    classificationWindow,
    strictness,
    10_000,
    learningExamples.slice(0, 3)
  );
  const decision = semantic.decision;
  const acceptedFocused = acceptsSemanticFocus({
    decision,
    strictness,
    hasFirefoxContent: Boolean(
      classificationWindow.browser === 'firefox' && classificationWindow.content?.trim()
    ),
  });
  const technicalFailure = !decision;
  const semanticCategory = acceptedFocused ? productiveCategory : distractionCategory;
  const categoryAlias = decision?.categoryAlias?.trim().toLocaleLowerCase();
  const aliasCategory = categoryAlias
    ? userCategories.find(
        (category) =>
          category.name.trim().toLocaleLowerCase() === categoryAlias &&
          category.isProductive === acceptedFocused
      )
    : null;
  const determinedCategory = aliasCategory || semanticCategory || null;
  const learnedEvidenceAccepted = Boolean(
    acceptedFocused && decision?.learningExampleId && decision.learningSimilarity === 'close'
  );
  const finalRelation = acceptedFocused ? decision?.relation || 'direct' : decision ? 'none' : null;
  const categoryReasoning = technicalFailure
    ? 'Local AI could not complete the comparison.'
    : acceptedFocused
      ? learnedEvidenceAccepted
        ? 'Focused · learned from a similar correction.'
        : finalRelation === 'supporting'
          ? `Focused · supports the current target through ${String(decision?.supportingMode).replace(/_/g, ' ')}.`
          : 'Focused · visible activity directly advances the current target.'
      : 'Distracted · no sufficiently grounded connection to the current target.';

  // Goal-only profiling begins after foreground inference and can never delay
  // or retain Firefox content from this request.
  ensureGoalSupportProfiles(userId, userGoals);

  return {
    goalSnapshot: snapshotGoalContext(userGoals),
    categoryId: technicalFailure ? null : determinedCategory?._id || null,
    categoryReasoning,
    classificationStatus: technicalFailure
      ? semantic.failureCode === 'timeout' || semantic.failureCode === 'ollama_http_error'
        ? 'ollama_unavailable'
        : 'invalid_response'
      : learnedEvidenceAccepted
        ? 'policy_override'
        : 'ollama',
    activityKey,
    pageCorrectionKey,
    activityLabel: acceptedFocused
      ? classificationWindow.title || classificationWindow.ownerName
      : distractionActivityLabel(classificationWindow),
    activitySummary: acceptedFocused ? null : offGoalSummary(userGoals),
    nudgeTitle: null,
    nudgeBody: null,
    goalContextFingerprint,
    classificationContextFingerprint: classificationFingerprint,
    goalRelation: finalRelation,
    supportingMode: finalRelation === 'supporting' ? decision?.supportingMode || null : null,
    classificationFailureCode: technicalFailure ? semantic.failureCode || null : null,
    classificationAttemptCount: semantic.attemptCount,
    // These fields remain for event/schema compatibility. New semantic
    // decisions never persist a goal-blind page descriptor or raw evidence.
    pageDescriptorRevision: null,
    pageKind:
      finalRelation === 'direct'
        ? 'other'
        : decision?.supportingMode === 'study_notes_or_retrieval'
          ? 'learning'
          : decision?.supportingMode === 'read_reference'
            ? 'reference'
            : decision?.supportingMode === 'coding_or_analysis'
              ? 'coding'
              : decision?.supportingMode === 'drafting_or_problem_solving'
                ? 'writing'
                : decision?.supportingMode === 'calculation_or_visualization'
                  ? 'problem_solving'
                  : 'unknown',
    pageDescriptorTopicCues: [],
    evidenceQuality: decision
      ? decision.evidenceAliases.includes('E4')
        ? 'strong'
        : decision.evidenceAliases.some((alias) => alias !== 'E1')
          ? 'partial'
          : 'weak'
      : null,
    decisionConfidence: decision?.confidence || null,
    matchedGoalRef: acceptedFocused ? decision?.matchedGoalRef || null : null,
    classificationLatencyMs: Math.round(performance.now() - classificationStartedAt),
    classifierStrictness: strictness,
    learningToolKey: learningTool?.key || null,
    learningToolKind: learningTool?.kind || null,
    learningToolLabel: learningTool?.label || null,
    learningExampleId: learnedEvidenceAccepted ? decision?.learningExampleId || null : null,
  };
}
