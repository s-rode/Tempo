/**
 * Estimates model time saved per day by the decision memo, from the local
 * history. Read-only: it projects status, attempt count, latency, timestamp and
 * the two opaque fingerprints, never titles or page text.
 *
 *   bun server/scripts/estimate-model-time-saved.ts [--days 21] [--user <id>] [--json]
 *
 * MONGODB_URI defaults to the bundled local server's database. Run it on the
 * Mac with Tempo (or its local MongoDB) running. See estimateModelTimeSaved for
 * what "observed" and "possible" mean.
 */
import mongoose from 'mongoose';
import { ActiveWindowEventModel } from '../src/models/activeWindowEvent';
import {
  estimateModelTimeSaved,
  type DailyModelTimeSaved,
  type ModelHistoryEvent,
} from '../src/services/categorization/modelTimeSaved';

const argument = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};
const days = Number(argument('days') ?? 21);
const userId = argument('user');
const asJson = process.argv.includes('--json');
const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tempo_local';

const minutes = (ms: number) => (ms / 60000).toFixed(1);
const percent = (part: number, whole: number) =>
  whole ? `${Math.round((100 * part) / whole)}%` : '-';

function printTable(rows: DailyModelTimeSaved[]) {
  const header = [
    'Day',
    'Model runs',
    'Model min',
    'Hits',
    'Saved min (observed)',
    'Repeats',
    'Saved min (possible)',
    'Possible share',
    'History reuses',
  ];
  const lines = rows.map((row) => [
    row.day,
    String(row.modelRuns),
    minutes(row.modelMs),
    String(row.observedHits),
    minutes(row.observedSavedMs),
    `${row.repeats} (${row.repeatRuns} ran)`,
    minutes(row.possibleSavedMs),
    // Share of the model time the day would have cost without any memo.
    percent(row.possibleSavedMs, row.modelMs + row.observedSavedMs),
    String(row.historyReuses),
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...lines.map((line) => line[column].length))
  );
  const format = (cells: string[]) =>
    cells
      .map((cell, column) =>
        column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column])
      )
      .join('  ');
  console.log(format(header));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const line of lines) console.log(format(line));
}

try {
  await mongoose.connect(uri);
  const filter: Record<string, unknown> = {
    timestamp: { $gte: Date.now() - days * 24 * 60 * 60 * 1000 },
  };
  if (userId) filter.userId = userId;
  else {
    const users = await ActiveWindowEventModel.distinct('userId', filter);
    if (users.length > 1) {
      console.error(`Several users have events (${users.join(', ')}). Pass --user <id>.`);
      process.exit(2);
    }
  }
  const events = (await ActiveWindowEventModel.find(filter)
    .select(
      'timestamp classificationStatus classificationAttemptCount classificationLatencyMs activityKey classificationContextFingerprint -_id'
    )
    .lean()) as ModelHistoryEvent[];
  const rows = estimateModelTimeSaved(events);
  if (asJson) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log(`${events.length} events over the last ${days} days\n`);
    printTable(rows);
    console.log(
      '\nObserved: events answered without running the model, valued at what that activity cost to run that day.' +
        '\nPossible: every repeat of an activity and context decided in the previous 6 hours (an upper bound).' +
        '\nLatency is wall time per classification, including any wait behind another request.'
    );
  }
} finally {
  await mongoose.disconnect();
}
