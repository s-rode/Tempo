import { describe, expect, test } from 'bun:test';
import { isReusableFirefoxNavigationSource } from './navigationCache';

describe('Firefox navigation-cache source guard', () => {
  const title = 'ChatGPT - quant interview prep';

  test('accepts a direct OCR-backed decision for the same title', () => {
    expect(
      isReusableFirefoxNavigationSource(
        { title, categoryId: 'work', classificationStatus: 'ollama' },
        title
      )
    ).toBe(true);
  });

  test('rejects a stale navigation identity when the visible tab title changed', () => {
    expect(
      isReusableFirefoxNavigationSource(
        { title: 'glencore - Google Suche', categoryId: 'distraction', classificationStatus: 'ollama' },
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
});
