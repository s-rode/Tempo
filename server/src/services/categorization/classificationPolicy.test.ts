import { describe, expect, test } from 'bun:test';
import {
  acceptsSemanticFocus,
  allowsDirectEvidence,
  allowsSupportingEvidence,
} from './classificationPolicy';

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

describe('grounded semantic strictness', () => {
  const decision = {
    state: 'focused' as const,
    relation: 'supporting' as const,
    matchedGoalRef: 'daily:goal',
    supportingMode: 'study_notes_or_retrieval',
    confidence: 'medium' as const,
    evidenceAliases: ['E2'],
    learningExampleId: null,
    learningSimilarity: 'none' as const,
  };

  test('does not require literal goal tokens but always requires cited evidence', () => {
    expect(
      acceptsSemanticFocus({ decision, strictness: 'flexible', hasFirefoxContent: false })
    ).toBe(true);
    expect(
      acceptsSemanticFocus({
        decision: { ...decision, evidenceAliases: [] },
        strictness: 'flexible',
        hasFirefoxContent: false,
      })
    ).toBe(false);
  });

  test('keeps all three modes distinct', () => {
    expect(
      acceptsSemanticFocus({ decision, strictness: 'flexible', hasFirefoxContent: false })
    ).toBe(true);
    expect(
      acceptsSemanticFocus({ decision, strictness: 'balanced', hasFirefoxContent: false })
    ).toBe(false);
    expect(acceptsSemanticFocus({ decision, strictness: 'strict', hasFirefoxContent: false })).toBe(
      false
    );
    expect(
      acceptsSemanticFocus({
        decision: { ...decision, confidence: 'high' },
        strictness: 'strict',
        hasFirefoxContent: false,
      })
    ).toBe(true);
  });

  test('lets only Flexible use a close learned application-only preference', () => {
    const learned = {
      ...decision,
      evidenceAliases: ['E1'],
      learningExampleId: 'learned',
      learningSimilarity: 'close' as const,
    };
    expect(
      acceptsSemanticFocus({ decision: learned, strictness: 'flexible', hasFirefoxContent: false })
    ).toBe(true);
    expect(
      acceptsSemanticFocus({ decision: learned, strictness: 'balanced', hasFirefoxContent: false })
    ).toBe(false);
    expect(
      acceptsSemanticFocus({
        decision: { ...learned, confidence: 'high' },
        strictness: 'strict',
        hasFirefoxContent: false,
      })
    ).toBe(false);
  });
});
