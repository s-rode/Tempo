import { describe, expect, test } from 'bun:test';
import {
  matchesRetroactiveScope,
  retroactiveScope,
  type RetroactiveEvent,
} from './retroactiveClassification';

const event = (changes: Partial<RetroactiveEvent> = {}): RetroactiveEvent => ({
  type: 'window',
  ownerName: 'Claude',
  learningToolKey: 'app:claude',
  categoryId: null,
  classificationStatus: 'insufficient_context',
  goalSnapshot: { sessionId: 'run-1' },
  ...changes,
});

describe('retroactive classification scope', () => {
  const scope = retroactiveScope([event({ categoryId: 'work', classificationStatus: 'manual' })]);

  test('an uncertain event of the same tool in the same session is covered', () => {
    expect(matchesRetroactiveScope(event(), scope)).toBe(true);
  });

  test('other sessions, other tools and classified events are left alone', () => {
    expect(matchesRetroactiveScope(event({ goalSnapshot: { sessionId: 'run-2' } }), scope)).toBe(
      false
    );
    expect(matchesRetroactiveScope(event({ goalSnapshot: null }), scope)).toBe(false);
    expect(matchesRetroactiveScope(event({ learningToolKey: 'app:chess' }), scope)).toBe(false);
    expect(matchesRetroactiveScope(event({ categoryId: 'distraction' }), scope)).toBe(false);
    expect(matchesRetroactiveScope(event({ classificationStatus: 'manual' }), scope)).toBe(false);
  });

  test('a manual classification is never overwritten, even if it has no category', () => {
    expect(matchesRetroactiveScope(event({ classificationStatus: 'manual' }), scope)).toBe(false);
  });

  test('a corrected event without a session extends to nothing', () => {
    const none = retroactiveScope([event({ goalSnapshot: null })]);
    expect(none.sessionIds.size).toBe(0);
    expect(matchesRetroactiveScope(event(), none)).toBe(false);
  });

  test('events without a tool identity match by app name, and only windows do', () => {
    const byOwner = retroactiveScope([event({ learningToolKey: null, ownerName: ' Claude ' })]);
    expect(matchesRetroactiveScope(event({ learningToolKey: null, ownerName: 'claude' }), byOwner))
      .toBe(true);
    expect(matchesRetroactiveScope(event({ learningToolKey: null, ownerName: 'Chess' }), byOwner))
      .toBe(false);
    expect(
      matchesRetroactiveScope(event({ learningToolKey: null, type: 'browser' }), byOwner)
    ).toBe(false);
  });

  test('system events are never part of a scope', () => {
    expect(retroactiveScope([event({ type: 'system' })]).sessionIds.size).toBe(0);
  });
});
