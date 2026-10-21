import type { ClassifierStrictness } from '../../../../shared/types';

export const DEFAULT_CLASSIFIER_STRICTNESS: ClassifierStrictness = 'strict';

export const isClassifierStrictness = (value: unknown): value is ClassifierStrictness =>
  value === 'flexible' || value === 'balanced' || value === 'strict';

interface GroundedSemanticDecision {
  state: 'focused' | 'distracted' | 'uncertain';
  relation: 'direct' | 'supporting' | 'none';
  matchedGoalRef: string | null;
  supportingMode: string | null;
  confidence: 'high' | 'medium' | 'low';
  evidenceAliases: string[];
  learningExampleId: string | null;
  learningSimilarity: 'close' | 'related' | 'none';
}

/**
 * Strictness calibrates grounded semantic evidence rather than checking for
 * literal word overlap. The model may understand acronyms and paraphrases,
 * while the server still verifies that it cited evidence from this request.
 */
export function acceptsSemanticFocus(input: {
  decision: GroundedSemanticDecision | null;
  strictness: ClassifierStrictness;
  hasFirefoxContent: boolean;
}): boolean {
  const { decision, strictness, hasFirefoxContent } = input;
  if (
    !decision ||
    decision.state !== 'focused' ||
    decision.relation === 'none' ||
    !decision.matchedGoalRef ||
    decision.evidenceAliases.length === 0 ||
    decision.confidence === 'low'
  )
    return false;
  const citedBeyondApplication = decision.evidenceAliases.some((alias) => alias !== 'E1');
  const closeLearnedTool = Boolean(
    decision.learningExampleId && decision.learningSimilarity === 'close'
  );
  if (strictness === 'flexible') return citedBeyondApplication || closeLearnedTool;
  if (strictness === 'balanced') {
    if (!citedBeyondApplication) return false;
    return (
      decision.relation === 'direct' ||
      decision.confidence === 'high' ||
      (hasFirefoxContent && decision.confidence === 'medium')
    );
  }
  return decision.confidence === 'high' && citedBeyondApplication;
}

/**
 * The model describes the relation; this policy decides how much visible
 * evidence a user wants before Tempo treats it as focused work.
 */
export const allowsDirectEvidence = (input: {
  strictness: ClassifierStrictness;
  evidenceQuality: 'strong' | 'partial' | 'weak';
  strongTopicMatch: boolean;
  anyTopicMatch: boolean;
  explicitApplicationMatch: boolean;
}): boolean => {
  const { strictness, evidenceQuality, strongTopicMatch, anyTopicMatch, explicitApplicationMatch } =
    input;
  if (evidenceQuality === 'weak') return false;
  if (strictness === 'strict') return strongTopicMatch || explicitApplicationMatch;
  if (strictness === 'balanced')
    return (
      strongTopicMatch ||
      explicitApplicationMatch ||
      (anyTopicMatch && evidenceQuality === 'strong')
    );
  return strongTopicMatch || explicitApplicationMatch || anyTopicMatch;
};

export const allowsSupportingEvidence = (input: {
  strictness: ClassifierStrictness;
  evidenceQuality: 'strong' | 'partial' | 'weak';
  confidence: 'high' | 'medium' | 'low' | null | undefined;
  compatibleMethod: boolean;
}): boolean => {
  const { strictness, evidenceQuality, confidence, compatibleMethod } = input;
  if (!compatibleMethod || evidenceQuality === 'weak' || confidence === 'low') return false;
  if (strictness === 'strict') return confidence === 'high';
  if (strictness === 'balanced')
    return confidence === 'high' || (confidence === 'medium' && evidenceQuality === 'strong');
  return confidence === 'high' || confidence === 'medium';
};
