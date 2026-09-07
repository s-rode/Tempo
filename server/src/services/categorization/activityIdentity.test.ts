import { describe, expect, test } from 'bun:test';
import {
  activityKeyFor,
  canonicalPageIdentity,
  fingerprintCapturedContent,
  pageCorrectionKeyFor,
} from './activityIdentity';

describe('Firefox activity identity', () => {
  test('uses normalized title plus OCR fingerprint rather than Firefox as one app', () => {
    const first = fingerprintCapturedContent('Gaussian Process tutorial visible text');
    const second = fingerprintCapturedContent('General news article visible text');
    const base = {
      ownerName: 'Firefox',
      title: 'Study',
      url: null,
      type: 'browser' as const,
      browser: 'firefox' as const,
    };
    expect(activityKeyFor(base, first)).not.toBe(activityKeyFor(base, second));
  });

  test('normalizes equivalent OCR whitespace before fingerprinting', () => {
    expect(fingerprintCapturedContent('one\n\n two')).toBe(fingerprintCapturedContent('one two'));
  });

  test('uses a stable opaque page key without query or fragment state', () => {
    const desmos = {
      ownerName: 'Chrome',
      title: 'Desmos Graphing Calculator',
      type: 'browser' as const,
      browser: 'chrome' as const,
      content: null,
    };
    const first = pageCorrectionKeyFor({
      ...desmos,
      url: 'https://www.desmos.com/calculator?state=first#graph',
    });
    const revisit = pageCorrectionKeyFor({
      ...desmos,
      url: 'https://www.desmos.com/calculator?state=second',
    });
    const differentPage = pageCorrectionKeyFor({
      ...desmos,
      url: 'https://www.desmos.com/scientific',
    });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(revisit);
    expect(first).not.toBe(differentPage);
    expect(canonicalPageIdentity('https://www.desmos.com/calculator?state=first#graph')).toBe(
      'https://www.desmos.com/calculator'
    );
  });

  test('accepts the native Firefox page fingerprint without using OCR text', () => {
    const pageCorrectionKey = 'a'.repeat(64);
    expect(
      pageCorrectionKeyFor({
        type: 'browser',
        browser: 'firefox',
        url: null,
        pageCorrectionKey,
      })
    ).toBe(pageCorrectionKey);
  });
});
