/** Deterministic CPU benchmark; never reads Tempo data or contacts services.
 * bun server/scripts/benchmark-analytics.ts [baseline-module-path]
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import * as current from '../src/services/analytics';
import type { ActiveWindowEvent, Category } from '../../shared/types';

const minute = 60_000;
const day = 24 * 60 * minute;
// Winter fixture avoids making CPU results depend on the host's DST date.
const end = new Date(2026, 1, 18, 15).getTime();
const start = end - 70 * day;
const categories = [
  { _id: 'work', name: 'Work', color: '#00ff00', isProductive: true },
  { _id: 'other', name: 'Other', color: '#ff0000', isProductive: false },
] as Category[];
const events: ActiveWindowEvent[] = Array.from({ length: 33_600 }, (_, index) => ({
  userId: 'benchmark', timestamp: start + index * 3 * minute,
  ownerName: index % 9 === 0 ? 'System Lock' : index % 3 ? 'Editor' : 'Browser',
  title: '', type: index % 9 === 0 ? 'system' : 'window',
  categoryId: index % 9 === 0 ? null : index % 3 ? 'work' : 'other',
}));
type AnalyticsModule = typeof current;
const run = (api: AnalyticsModule) => ({
  period: api.calculatePeriodAnalytics(events, categories, end - 7 * day, end, end),
  matching: api.averageMatchingWeekdayByTime({ events, categories, comparisonAtMs: end, nowMs: end }),
  comparable: api.averageComparableDaysByTime({ events, categories, comparisonAtMs: end, mode: 'all_active_days', nowMs: end }),
});
// Equal-duration category ordering has no semantic significance.
const normalize = (value: ReturnType<typeof run>) => {
  const order = (rows: typeof value.period.categoryTotals) => rows.sort((a, b) => a.categoryId.localeCompare(b.categoryId));
  order(value.period.categoryTotals);
  value.period.days.forEach(row => order(row.categoryTotals));
  return value;
};
const measure = (api: AnalyticsModule) => {
  run(api);
  const iterations = 10;
  const before = process.cpuUsage();
  const started = performance.now();
  for (let index = 0; index < iterations; index++) run(api);
  const cpu = process.cpuUsage(before);
  return { iterations, wallMs: +(performance.now() - started).toFixed(2), cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(2) };
};
if (process.argv[2]) {
  const baseline = await import(resolve(process.argv[2])) as AnalyticsModule;
  assert.deepEqual(normalize(run(current)), normalize(run(baseline)));
  console.log(JSON.stringify({ baseline: measure(baseline), optimized: measure(current), outputsEqual: true, events: events.length }));
} else {
  console.log(JSON.stringify({ optimized: measure(current), events: events.length }));
}
