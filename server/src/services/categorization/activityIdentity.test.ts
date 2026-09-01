import { describe, expect, test } from 'bun:test';
import { activityKeyFor, fingerprintCapturedContent } from './activityIdentity';

describe('Firefox activity identity', () => {
  test('uses normalized title plus OCR fingerprint rather than Firefox as one app', () => {
    const first = fingerprintCapturedContent('Gaussian Process tutorial visible text');
    const second = fingerprintCapturedContent('General news article visible text');
    const base = { ownerName: 'Firefox', title: 'Study', url: null, type: 'browser' as const, browser: 'firefox' as const };
    expect(activityKeyFor(base, first)).not.toBe(activityKeyFor(base, second));
  });

  test('normalizes equivalent OCR whitespace before fingerprinting', () => {
    expect(fingerprintCapturedContent('one\n\n two')).toBe(fingerprintCapturedContent('one two'));
  });
});
