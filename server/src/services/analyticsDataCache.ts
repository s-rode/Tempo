import { ActiveWindowEventModel } from '../models/activeWindowEvent';
import { CategoryModel } from '../models/category';

type AnalyticsInputs = {
  previous: Record<string, unknown> | null;
  events: Array<Record<string, unknown>>;
  categories: Array<Record<string, unknown>>;
};

const entries = new Map<string, AnalyticsInputs>();
const MAX_ENTRIES = 12;

const keyFor = (userId: string, startDateMs: number, endDateMs: number) =>
  `${userId}:${startDateMs}:${endDateMs}`;

/**
 * Analytics needs only interval/category fields. Keep this small local
 * snapshot in memory between minute-aligned dashboard refreshes; mutations
 * invalidate it synchronously, so it never trades correctness for a TTL.
 */
export async function analyticsInputsFor(
  userId: string,
  startDateMs: number,
  endDateMs: number
): Promise<AnalyticsInputs> {
  const key = keyFor(userId, startDateMs, endDateMs);
  const cached = entries.get(key);
  if (cached) return cached;

  const [previous, events, categories] = await Promise.all([
    ActiveWindowEventModel.findOne({ userId, timestamp: { $lt: startDateMs } })
      .sort({ timestamp: -1 })
      .select('_id ownerName type categoryId timestamp')
      .lean(),
    ActiveWindowEventModel.find({ userId, timestamp: { $gte: startDateMs, $lt: endDateMs } })
      .sort({ timestamp: 1 })
      .select('_id ownerName type categoryId timestamp')
      .lean(),
    CategoryModel.find({ userId }).select('_id name color isProductive').lean(),
  ]);
  const value: AnalyticsInputs = {
    previous: previous as Record<string, unknown> | null,
    events: events as Array<Record<string, unknown>>,
    categories: categories as Array<Record<string, unknown>>,
  };
  entries.set(key, value);
  // Tempo is single-user, but navigating historical periods should not turn
  // an in-memory convenience cache into unbounded retained history.
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (!oldest) break;
    entries.delete(oldest);
  }
  return value;
}

export function invalidateAnalyticsInputs(userId: string): void {
  const prefix = `${userId}:`;
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}
