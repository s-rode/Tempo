import type { ClassifierStrictness } from '../../../../shared/types';

export const DEFAULT_CLASSIFIER_STRICTNESS: ClassifierStrictness = 'strict';

export const isClassifierStrictness = (value: unknown): value is ClassifierStrictness =>
  value === 'flexible' || value === 'balanced' || value === 'strict';

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
