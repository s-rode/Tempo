import { describe, test, expect } from 'bun:test';
import { sampleProductiveBlocks } from './reviewSampling';
import type { ActiveWindowEvent } from '../../../../shared/types';
const event = (
  id: string,
  title: string,
  timestamp: number,
  basis: ActiveWindowEvent['classificationBasis'] = 'visible_relevance'
): ActiveWindowEvent => ({
  userId: 'u',
  eventId: id,
  ownerName: 'Tool',
  type: 'window',
  title,
  timestamp,
  categoryId: 'work',
  classificationBasis: basis,
  classificationStatus: 'ollama',
  goalContextFingerprint: 'goal',
});
describe('optional productive review sampling', () => {
  test('samples blocks rather than rewarding high capture frequency', () => {
    const events = [event('1', 'First', 1), event('2', 'First', 2), event('3', 'Second', 3)];
    const samples = sampleProductiveBlocks(events, new Set(['work']), () => 0);
    expect(samples).toHaveLength(1);
    expect(samples[0].eventIds).toEqual(['1', '2']);
    expect(samples[0].population).toBe(2);
    expect(samples[0].inclusionProbability).toBe(0.5);
  });
  test('keeps random and targeted strata distinct and deduplicates selections', () => {
    const events = [
      event('1', 'First', 1),
      event('2', 'Learned', 2, 'list_preference'),
      event('3', 'Role', 3, 'tool_role'),
    ];
    const samples = sampleProductiveBlocks(events, new Set(['work']), () => 0);
    expect(samples.map((s) => s.stratum)).toEqual(['random', 'learned', 'tool_role']);
    expect(new Set(samples.flatMap((s) => s.eventIds)).size).toBe(3);
  });
  test('manual decisions and uncertain intervals cannot become automatic productive samples', () => {
    const samples = sampleProductiveBlocks(
      [
        { ...event('1', 'Manual', 1), classificationStatus: 'manual' },
        { ...event('2', 'Unknown', 2), categoryId: null },
        event('3', 'Actual', 3),
      ],
      new Set(['work']),
      () => 0
    );
    expect(samples.map((s) => s.eventIds)).toEqual([['3']]);
  });
});
