import { describe, expect, test } from 'bun:test';
import type { ActiveWindowEvent, Category } from '../../../shared/types';
import { averageActiveDaysByTime, averageComparableDaysByTime, averageMatchingWeekdayByTime, calculatePeriodAnalytics } from './analytics';

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const monday = new Date(2026, 8, 7, 0, 0, 0, 0).getTime();
const categories: Category[] = [
  { _id: 'work', userId: 'u', name: 'Work', color: '#22c55e', isProductive: true, createdAt: new Date(), updatedAt: new Date() },
  { _id: 'distraction', userId: 'u', name: 'Distraction', color: '#f43f5e', isProductive: false, createdAt: new Date(), updatedAt: new Date() }
];
const event = (timestamp: number, ownerName: string, categoryId: string | null): ActiveWindowEvent => ({ userId: 'u', ownerName, title: ownerName, type: 'window', timestamp, categoryId });

describe('Tempo analytics interval aggregation', () => {
  test('splits a continuous activity across day and hour boundaries', () => {
    const result = calculatePeriodAnalytics([event(monday + 23 * hour, 'RemNote', 'work')], categories, monday, monday + day, monday + day);
    expect(result.totals.focusedMs).toBe(hour);
    expect(result.hours[23].focusedMs).toBe(hour);
    expect(result.days[0].focusedMs).toBe(hour);
  });

  test('daily category totals include carry-in across midnight and stop at system boundaries', () => {
    const events = [
      event(monday - hour, 'Editor', 'work'),
      { ...event(monday + hour, 'System Sleep', null), type: 'system' as const },
      event(monday + 25 * hour, 'Browser', 'distraction'),
    ];
    const result = calculatePeriodAnalytics(events, categories, monday, monday + 2 * day, monday + 2 * day);
    expect(result.days[0].categoryTotals.map(row => [row.categoryId, row.durationMs])).toEqual([['work', hour]]);
    expect(result.days[1].categoryTotals.map(row => [row.categoryId, row.durationMs])).toEqual([['distraction', 4 * hour]]);
    expect(result.categoryTotals.reduce((total, row) => total + row.durationMs, 0)).toBe(result.totals.trackedMs);
  });

  test('range lookup retains the last equal-timestamp boundary and does not mutate inputs', () => {
    const events = [
      event(monday + hour, 'Editor', 'work'),
      { ...event(monday + hour, 'System Sleep', null), type: 'system' as const },
      event(monday + 4 * hour, 'Browser', 'distraction'),
    ];
    const original = [...events];
    const result = calculatePeriodAnalytics(events, categories, monday + 2 * hour, monday + 3 * hour, monday + day);
    expect(result.totals.trackedMs).toBe(0);
    expect(result.days[0].categoryTotals).toEqual([]);
    expect(events).toEqual(original);
  });

  test('does not turn a missed overnight boundary into a full day of focus', () => {
    const result = calculatePeriodAnalytics([event(monday + 9 * hour, 'RemNote', 'work')], categories, monday, monday + day, monday + day);
    expect(result.totals.focusedMs).toBe(4 * hour);
  });

  test('counts only application changes, never browser tab changes or system boundaries', () => {
    const events = [
      event(monday + hour, 'Firefox', 'work'),
      event(monday + 2 * hour, 'Firefox', 'work'),
      event(monday + 3 * hour, 'RemNote', 'work'),
      { ...event(monday + 4 * hour, 'System Lock', null), type: 'system' as const },
      event(monday + 5 * hour, 'RemNote', 'work'),
      event(monday + 6 * hour, 'Music', 'distraction')
    ];
    const result = calculatePeriodAnalytics(events, categories, monday, monday + day, monday + day);
    expect(result.totals.appSwitches).toBe(2);
  });

  test('matches string event category IDs with Mongo-style object category IDs', () => {
    const mongoLikeCategories = categories.map((category) => ({ ...category, _id: { toString: () => category._id } })) as unknown as Category[];
    const result = calculatePeriodAnalytics([event(monday + hour, 'RemNote', 'work')], mongoLikeCategories, monday, monday + day, monday + 2 * hour);
    expect(result.totals.focusedMs).toBe(hour);
    expect(result.totals.uncertainMs).toBe(0);
  });

  test('averages only prior matching active weekdays through the same clock time', () => {
    const comparisonAt = monday + 15 * hour;
    const events = [
      event(monday - 7 * day + 9 * hour, 'RemNote', 'work'),
      event(monday - 7 * day + 11 * hour, 'Music', 'distraction'),
      event(monday - 14 * day + 9 * hour, 'RemNote', 'work'),
      event(monday - 14 * day + 13 * hour, 'Music', 'distraction')
    ];
    const baseline = averageMatchingWeekdayByTime({ events, categories, comparisonAtMs: comparisonAt, nowMs: comparisonAt });
    expect(baseline.sampleCount).toBe(2);
    expect(baseline.focusedMs).toBe(3 * hour);
  });

  test('averages recent active days through the same local clock time', () => {
    const comparisonAt = monday + 15 * hour;
    const events = [
      event(monday - day + 9 * hour, 'RemNote', 'work'),
      event(monday - day + 12 * hour, 'Music', 'distraction'),
      event(monday - 2 * day + 10 * hour, 'RemNote', 'work'),
      event(monday - 2 * day + 14 * hour, 'Music', 'distraction')
    ];
    const baseline = averageActiveDaysByTime({ events, categories, comparisonAtMs: comparisonAt, nowMs: comparisonAt });
    expect(baseline.sampleCount).toBe(2);
    expect(baseline.focusedMs).toBe(3.5 * hour);
  });

  test('can compare a weekend only to prior weekend days', () => {
    const saturday = monday - 2 * day;
    const comparisonAt = saturday + 15 * hour;
    const events = [
      event(saturday - day + 9 * hour, 'RemNote', 'work'), // Friday: excluded
      event(saturday - 7 * day + 10 * hour, 'RemNote', 'work'), // Previous Saturday
      event(saturday - 8 * day + 9 * hour, 'RemNote', 'work'), // Previous Friday: excluded
      event(saturday - 13 * day + 8 * hour, 'RemNote', 'work') // Previous Sunday
    ];
    const baseline = averageComparableDaysByTime({ events, categories, comparisonAtMs: comparisonAt, mode: 'same_day_type', nowMs: comparisonAt });
    expect(baseline.sampleCount).toBe(2);
    expect(baseline.focusedMs).toBe(4 * hour);
  });

  test('can compare only to previous occurrences of the same weekday', () => {
    const comparisonAt = monday + 15 * hour;
    const events = [
      event(monday - day + 9 * hour, 'RemNote', 'work'), // Sunday: excluded
      event(monday - 7 * day + 10 * hour, 'RemNote', 'work'),
      event(monday - 14 * day + 8 * hour, 'RemNote', 'work')
    ];
    const baseline = averageComparableDaysByTime({ events, categories, comparisonAtMs: comparisonAt, mode: 'same_weekday', nowMs: comparisonAt });
    expect(baseline.sampleCount).toBe(2);
    expect(baseline.focusedMs).toBe(4 * hour);
  });
});
