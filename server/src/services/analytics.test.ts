import { describe, expect, test } from 'bun:test';
import type { ActiveWindowEvent, Category } from '../../../shared/types';
import { averageMatchingWeekdayByTime, calculatePeriodAnalytics } from './analytics';

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
});
