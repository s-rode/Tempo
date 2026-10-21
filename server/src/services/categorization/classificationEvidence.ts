import type { ActiveWindowDetails } from '../../../../shared/types';
import type { EffectiveGoalTarget } from '../goalPlans';
import type { GoalRelationDecision } from './provider';
import type { PageActivityDescriptorData, PageKind } from './pageDescriptorTypes';
import type { SupportingMode } from './goalSupportTypes';
import type { ClassifierStrictness } from '../../../../shared/types';
import { allowsDirectEvidence, allowsSupportingEvidence } from './classificationPolicy';

const STOP_WORDS = new Set([
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

const GENERIC_APPLICATIONS = new Set([
  'chrome',
  'firefox',
  'safari',
  'browser',
  'finder',
  'tempo',
  'notch',
  'system',
]);

const normalizeToken = (token: string): string => {
  let value = token.toLocaleLowerCase();
  if (value.length > 5 && value.endsWith('ies')) value = `${value.slice(0, -3)}y`;
  else if (value.length > 5 && value.endsWith('ing')) value = value.slice(0, -3);
  else if (value.length > 4 && value.endsWith('es')) value = value.slice(0, -2);
  else if (value.length > 4 && value.endsWith('s')) value = value.slice(0, -1);
  return value;
};

const meaningfulTokens = (values: Array<string | null | undefined>): Set<string> =>
  new Set(
    values
      .join(' ')
      .normalize('NFKD')
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu)
      ?.map(normalizeToken)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)) || []
  );

const MODE_PAGE_KINDS: Record<SupportingMode, ReadonlySet<PageKind>> = {
  resource_navigation: new Set(['administration', 'reference']),
  calculation_or_visualization: new Set(['problem_solving']),
  study_notes_or_retrieval: new Set(['learning', 'note_taking']),
  read_reference: new Set(['reference', 'learning']),
  coding_or_analysis: new Set(['coding']),
  drafting_or_problem_solving: new Set(['writing', 'problem_solving']),
};

const MODE_MARKERS: Record<SupportingMode, RegExp> = {
  resource_navigation: /\b(dashboard|course|portal|navigation|materials)\w*/i,
  calculation_or_visualization:
    /\b(calculat|calculator|equation|formula|graph|plot|visuali[sz]|math)\w*/i,
  study_notes_or_retrieval: /\b(flashcard|note|quiz|recall|retriev|memor|practice)\w*/i,
  read_reference: /\b(documentation|reference|manual|paper|article|textbook|read)\w*/i,
  coding_or_analysis: /\b(code|coding|debug|implement|notebook|terminal|analy[sz]|dataset)\w*/i,
  drafting_or_problem_solving: /\b(draft|write|edit|exercise|problem|solve|solution)\w*/i,
};

type ActivityFacts = Pick<ActiveWindowDetails, 'ownerName' | 'title'>;
type Descriptor = Omit<PageActivityDescriptorData, 'revision'>;

export interface FocusEvidenceResult {
  accepted: boolean;
  deterministicDirect: boolean;
  matchedTokens: string[];
  explicitApplicationMatch: boolean;
  observedSupportingMethod: boolean;
}

/**
 * Treat the model as a proposer, not the policy authority. Focused needs
 * independently observable evidence: a named tool/topic for direct work, or
 * a high-confidence support claim whose method is actually visible.
 */
export function validateFocusedEvidence(input: {
  decision: GoalRelationDecision | null;
  target: EffectiveGoalTarget | null;
  activity: ActivityFacts;
  descriptor: Descriptor;
  strictness?: ClassifierStrictness;
}): FocusEvidenceResult {
  const { decision, target, activity, descriptor, strictness = 'strict' } = input;
  if (!target) {
    return {
      accepted: false,
      deterministicDirect: false,
      matchedTokens: [],
      explicitApplicationMatch: false,
      observedSupportingMethod: false,
    };
  }

  const goalTextTokens = meaningfulTokens([target.classificationText || target.text]);
  const activityTokens = meaningfulTokens([
    activity.ownerName,
    activity.title,
    descriptor.actionLabel,
    ...descriptor.topicCues,
  ]);
  // Deterministic direct evidence comes only from text the user actually
  // wrote. Generated profile cues may qualify a model-proposed supporting
  // method, but must never manufacture a direct match on their own.
  const matchedTokens = [...goalTextTokens].filter((token) => activityTokens.has(token));
  const applicationTokens = [...meaningfulTokens([activity.ownerName])].filter(
    (token) => !GENERIC_APPLICATIONS.has(token)
  );
  const explicitApplicationMatch =
    applicationTokens.length > 0 && applicationTokens.every((token) => goalTextTokens.has(token));
  const strongTopicMatch =
    matchedTokens.length >= 2 || matchedTokens.some((token) => token.length >= 6);
  const supportedDirectPageKind = new Set<PageKind>([
    'learning',
    'note_taking',
    'problem_solving',
    'reference',
    'coding',
    'writing',
  ]).has(descriptor.pageKind);
  const directEvidence = allowsDirectEvidence({
    strictness,
    evidenceQuality: descriptor.evidenceQuality,
    strongTopicMatch,
    anyTopicMatch: matchedTokens.length > 0,
    explicitApplicationMatch: explicitApplicationMatch && supportedDirectPageKind,
  });
  const deterministicDirect = directEvidence;

  const supportingMode = decision?.supportingMode || null;
  const visibleMethodText = `${descriptor.actionLabel} ${descriptor.topicCues.join(' ')}`;
  const observedSupportingMethod = Boolean(
    supportingMode &&
      (MODE_PAGE_KINDS[supportingMode].has(descriptor.pageKind) ||
        MODE_MARKERS[supportingMode].test(visibleMethodText))
  );
  const compatibleSupportingMode = Boolean(
    supportingMode &&
      target.supportProfile?.supportingModes.includes(supportingMode) &&
      observedSupportingMethod
  );
  const modelDirect =
    decision?.state === 'focused' &&
    decision.relation === 'direct' &&
    decision.confidence !== 'low' &&
    directEvidence;
  const modelSupporting =
    decision?.state === 'focused' &&
    decision.relation === 'supporting' &&
    allowsSupportingEvidence({
      strictness,
      evidenceQuality: descriptor.evidenceQuality,
      confidence: decision.confidence,
      compatibleMethod: compatibleSupportingMode,
    });

  return {
    accepted: deterministicDirect || modelDirect || modelSupporting,
    deterministicDirect: deterministicDirect && !modelDirect,
    matchedTokens,
    explicitApplicationMatch,
    observedSupportingMethod,
  };
}
