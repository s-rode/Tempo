import { describe, expect, test } from 'bun:test';
import { isReusableFirefoxNavigationSource } from './navigationCache';

describe('Firefox navigation-cache source guard', () => {
  const title = 'ChatGPT - quant interview prep';

  test('accepts a direct OCR-backed decision for the same title', () => {
    expect(
      isReusableFirefoxNavigationSource(
        {
          title,
          categoryId: 'work',
          classificationStatus: 'ollama',
          decisionConfidence: 'high',
          evidenceQuality: 'strong',
        },
        title
      )
    ).toBe(true);
  });

  test('rejects a stale navigation identity when the visible tab title changed', () => {
    expect(
      isReusableFirefoxNavigationSource(
        {
          title: 'glencore - Google Suche',
          categoryId: 'distraction',
          classificationStatus: 'ollama',
        },
        title
      )
    ).toBe(false);
  });

  test('does not let a cached result seed another cache hit', () => {
    expect(
      isReusableFirefoxNavigationSource(
        { title, categoryId: 'distraction', classificationStatus: 'navigation_cache' },
        title
      )
    ).toBe(false);
  });

  test('does not cache a weak or low-confidence automatic decision', () => {
    expect(
      isReusableFirefoxNavigationSource(
        {
          title,
          categoryId: 'work',
          classificationStatus: 'ollama',
          decisionConfidence: 'low',
          evidenceQuality: 'strong',
        },
        title
      )
    ).toBe(false);
  });

  test('reuses a resource-navigation decision while its allowance is valid', () => {
    const source = {
      title,
      categoryId: 'work',
      classificationStatus: 'ollama' as const,
      decisionConfidence: 'high' as const,
      evidenceQuality: 'partial' as const,
      decisionExpiresAtMs: 2_000,
    };
    expect(isReusableFirefoxNavigationSource(source, title, 1_000)).toBe(true);
    expect(isReusableFirefoxNavigationSource(source, title, 2_000)).toBe(false);
    expect(isReusableFirefoxNavigationSource(source, title, 3_000)).toBe(false);
  });
});
