import { describe, expect, test } from 'bun:test';
import { allowsDirectEvidence, allowsSupportingEvidence } from './classificationPolicy';

describe('classifier strictness policy', () => {
  test('keeps generic or weak direct evidence out at every setting', () => {
    for (const strictness of ['flexible', 'balanced', 'strict'] as const) {
      expect(
        allowsDirectEvidence({
          strictness,
          evidenceQuality: 'weak',
          strongTopicMatch: true,
          anyTopicMatch: true,
          explicitApplicationMatch: false,
        })
      ).toBe(false);
      expect(
        allowsDirectEvidence({
          strictness,
          evidenceQuality: 'strong',
          strongTopicMatch: false,
          anyTopicMatch: false,
          explicitApplicationMatch: false,
        })
      ).toBe(false);
    }
  });

  test('makes the direct-evidence threshold progressively stronger', () => {
    const partialSingleMatch = {
      evidenceQuality: 'partial' as const,
      strongTopicMatch: false,
      anyTopicMatch: true,
      explicitApplicationMatch: false,
    };
    expect(allowsDirectEvidence({ strictness: 'flexible', ...partialSingleMatch })).toBe(true);
    expect(allowsDirectEvidence({ strictness: 'balanced', ...partialSingleMatch })).toBe(false);
    expect(allowsDirectEvidence({ strictness: 'strict', ...partialSingleMatch })).toBe(false);
  });

  test('requires progressively stronger supporting evidence', () => {
    const mediumPartial = {
      evidenceQuality: 'partial' as const,
      confidence: 'medium' as const,
      compatibleMethod: true,
    };
    expect(allowsSupportingEvidence({ strictness: 'flexible', ...mediumPartial })).toBe(true);
    expect(allowsSupportingEvidence({ strictness: 'balanced', ...mediumPartial })).toBe(false);
    expect(allowsSupportingEvidence({ strictness: 'strict', ...mediumPartial })).toBe(false);
    expect(
      allowsSupportingEvidence({
        strictness: 'strict',
        evidenceQuality: 'strong',
        confidence: 'high',
        compatibleMethod: true,
      })
    ).toBe(true);
  });
});
