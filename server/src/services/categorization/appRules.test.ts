import { describe, expect, test } from 'bun:test';
import { findAppRule, normalizeAppKey, type AppRule } from './appRules';

const rules: AppRule[] = [
  { appKey: 'remnote', appName: 'RemNote', state: 'productive' },
  { appKey: 'chess', appName: 'Chess', state: 'unproductive' },
];

describe('app rules', () => {
  test('match the app regardless of window title or letter case', () => {
    expect(findAppRule(rules, { ownerName: 'RemNote' })?.state).toBe('productive');
    expect(findAppRule(rules, { ownerName: '  remnote ' })?.state).toBe('productive');
    expect(findAppRule(rules, { ownerName: 'Chess' })?.state).toBe('unproductive');
  });
  test('do not match other apps, partial names or system events', () => {
    expect(findAppRule(rules, { ownerName: 'Mail' })).toBeNull();
    expect(findAppRule(rules, { ownerName: 'Chess Clock' })).toBeNull();
    expect(findAppRule(rules, { ownerName: 'Chess', type: 'system' })).toBeNull();
    expect(findAppRule([], { ownerName: 'Chess' })).toBeNull();
    expect(findAppRule(undefined, { ownerName: 'Chess' })).toBeNull();
  });
  test('normalizes whitespace', () => {
    expect(normalizeAppKey('  Sys   Settings ')).toBe('sys settings');
  });
});
