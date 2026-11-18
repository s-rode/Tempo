import { describe, expect, test } from 'bun:test';
import { estimateModelTimeSaved, type ModelHistoryEvent } from './modelTimeSaved';

const HOUR = 60 * 60 * 1000;
const dayOf = (ms: number) => `d${Math.floor(ms / (24 * HOUR))}`;
const run = (
  timestamp: number,
  key: string,
  latency: number,
  status = 'ollama'
): ModelHistoryEvent => ({
  timestamp,
  activityKey: key,
  classificationContextFingerprint: 'ctx',
  classificationStatus: status,
  classificationAttemptCount: 1,
  classificationLatencyMs: latency,
});
const hit = (timestamp: number, key: string): ModelHistoryEvent => ({
  timestamp,
  activityKey: key,
  classificationContextFingerprint: 'ctx',
  classificationStatus: 'ollama',
  classificationAttemptCount: 0,
  classificationLatencyMs: 2,
});

describe('estimateModelTimeSaved', () => {
  test('before the memo: repeated runs are what a memo could have saved', () => {
    const [day] = estimateModelTimeSaved(
      [run(0, 'a', 3000), run(HOUR, 'a', 4000), run(2 * HOUR, 'b', 1000), run(3 * HOUR, 'a', 5000)],
      { dayOf }
    );
    expect(day.modelRuns).toBe(4);
    expect(day.modelMs).toBe(13000);
    expect(day.observedHits).toBe(0);
    expect(day.repeats).toBe(2);
    expect(day.repeatRuns).toBe(2);
    expect(day.possibleSavedMs).toBe(9000);
  });

  test('after the memo: hits are valued at what that activity cost to run', () => {
    const [day] = estimateModelTimeSaved(
      [run(0, 'a', 3000), hit(HOUR, 'a'), hit(2 * HOUR, 'zzz')],
      {
        dayOf,
      }
    );
    expect(day.observedHits).toBe(2);
    // 'a' cost 3000; 'zzz' never ran that day, so it takes the day's median run (3000).
    expect(day.observedSavedMs).toBe(6000);
    // 'zzz' was never decided, so an ideal memo could not have answered it either.
    expect(day.repeats).toBe(1);
    expect(day.possibleSavedMs).toBe(3000);
  });

  test('a decision expires after the TTL and failures are never memoized', () => {
    const [day] = estimateModelTimeSaved(
      [
        run(0, 'a', 3000),
        run(7 * HOUR, 'a', 3000),
        run(8 * HOUR, 'b', 10000, 'ollama_unavailable'),
        run(9 * HOUR, 'b', 2000),
      ],
      { dayOf }
    );
    expect(day.repeats).toBe(0);
    expect(day.possibleSavedMs).toBe(0);
  });

  test('days are kept apart and history reuses are counted separately', () => {
    const days = estimateModelTimeSaved(
      [
        run(0, 'a', 3000),
        { timestamp: HOUR, classificationStatus: 'history', classificationAttemptCount: 0 },
        run(25 * HOUR, 'a', 3000),
      ],
      { dayOf }
    );
    expect(days.map((day) => [day.day, day.historyReuses, day.repeats])).toEqual([
      ['d0', 1, 0],
      ['d1', 0, 0],
    ]);
  });
});
