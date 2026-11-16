import { OllamaClassificationProvider } from '../services/categorization/provider';
import {
  PERSONALIZED_POLICY_VERSION,
  resolvePersonalizedPolicy,
} from '../services/categorization/personalizedPolicy';
import { reminderClassificationText } from '../services/reminderRules';
import type { ClassifierStrictness } from '../../../shared/types';

/**
 * Runs an authored synthetic suite through the production foreground path:
 * the personalized local-model prompt followed by the deterministic policy,
 * with no learned preferences and no tool profile. No database access.
 *
 *   bun run classifier:eval:suite <out.json> [--suite=path] [--split=dev|holdout|all]
 *     [--ids=a,b] [--category=name] [--pace-ms=250] [--replay=previous.json]
 *     [--compare=previous.json] [--first-minute]
 *
 * One model call per case is scored under both Balanced and Strict, because
 * strictness only changes the deterministic policy, not the prompt.
 */
type Label = 'focused' | 'distracted' | 'uncertain';
interface SuiteCase {
  id: string;
  split: 'dev' | 'holdout';
  category: string;
  goal?: string;
  goals?: string[];
  list?: string;
  listContext?: string;
  app: string;
  title: string;
  browser?: 'firefox';
  host?: string;
  content?: string;
  contentSource?: 'ocr';
  expected: Label;
  /** Additional labels that are defensible for a genuinely ambiguous case. */
  acceptable?: Label[];
  /** For multi-target cases: the 1-based index of the target that must match. */
  target?: number;
}

const arg = (name: string) =>
  process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const output = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
if (!output) throw new Error('Usage: evaluateClassifierSuite.ts <out.json> [options]');
const suitePath = arg('suite') || `${import.meta.dir}/../../evaluation/scenarios-v3.json`;
const suite = (await Bun.file(suitePath).json()) as { version: number; cases: SuiteCase[] };
const split = arg('split') || 'dev';
const ids = arg('ids')?.split(',');
const category = arg('category');
const paceMs = Number(arg('pace-ms') || 250);
const replayPath = arg('replay');
const replayRows: any[] = replayPath ? (await Bun.file(replayPath).json()).results : [];
const cases = suite.cases.filter(
  (item) =>
    (split === 'all' || item.split === split) &&
    (!ids || ids.includes(item.id)) &&
    (!category || item.category === category)
);

const provider = new OllamaClassificationProvider();
const categories = [
  { name: 'Work', isProductive: true },
  { name: 'Distraction', isProductive: false },
];
const STRICTNESS = ['balanced', 'strict'] as const;
const results: any[] = [];

for (const item of cases) {
  const goalTexts = item.goals || [item.goal || ''];
  const targets = goalTexts.map((text, index) => ({
    ref: `session:suite:${index + 1}`,
    scope: 'session' as const,
    text,
    ...(item.list
      ? {
          classificationText: reminderClassificationText(
            text,
            item.list,
            '',
            item.listContext || ''
          ),
        }
      : {}),
    textFingerprint: `${item.id}:${index}`,
    supportProfile: null,
  }));
  const activity = {
    ownerName: item.app,
    title: item.title,
    type: (item.browser || /firefox|chrome|safari|edge|arc|brave/i.test(item.app)
      ? 'browser'
      : 'window') as 'browser' | 'window',
    browser: item.browser || null,
    content: item.content || null,
    contentSource: item.contentSource || null,
    siteHost: item.browser ? item.host || null : null,
  };
  const replay = replayRows.find((row) => row.id === item.id);
  if (!replay) await new Promise((resolve) => setTimeout(resolve, paceMs));
  const started = performance.now();
  const response = replay
    ? { decision: replay.decision, failureCode: replay.failure, attemptCount: replay.attempts }
    : await provider.decideActivity(
        { scope: 'session', primaryGoal: goalTexts[0], dailyTasks: [], targets },
        categories,
        activity as any,
        'balanced',
        10_000,
        [],
        true
      );
  const latencyMs = replay?.latencyMs ?? Math.round(performance.now() - started);
  const decision = response.decision;
  const proposal = decision
    ? { ...decision, assessment: decision.assessment || ('opaque' as const) }
    : null;
  // Mirrors classifyPersonalized: a title that merely repeats the app name is
  // not independent evidence, while a Firefox hostname or page text is.
  const title = item.title.trim().toLocaleLowerCase();
  const independentEvidence = Boolean(
    proposal?.evidenceAliases.some((alias: string) =>
      alias === 'E2'
        ? title && title !== item.app.trim().toLocaleLowerCase()
        : alias === 'E3' || alias === 'E4'
    )
  );
  const historical = targets.map((target) => ({
    ref: target.ref,
    taskKey: target.textFingerprint,
    text: target.text,
    classificationText: (target as any).classificationText || target.text,
    listKey: null,
    listName: item.list || null,
    listContext: item.listContext || null,
    supportingModes: [],
    profileRevision: null,
  }));
  const predicted = Object.fromEntries(
    STRICTNESS.map((strictness) => {
      const resolution = resolvePersonalizedPolicy({
        proposal: proposal as any,
        targets: historical,
        preferences: [],
        toolProfile: null,
        strictness,
        independentEvidence,
        // Steady state: the 60-second navigation allowance has run out.
        navigationAllowed: process.argv.includes('--first-minute'),
      });
      const wrongTarget =
        resolution.state === 'focused' &&
        item.target !== undefined &&
        resolution.target?.ref !== `session:suite:${item.target}`;
      return [strictness, { state: resolution.state, basis: resolution.basis, wrongTarget }];
    })
  ) as Record<(typeof STRICTNESS)[number], { state: Label; basis: string; wrongTarget: boolean }>;
  results.push({
    id: item.id,
    category: item.category,
    expected: item.expected,
    acceptable: item.acceptable || [],
    predicted,
    decision,
    failure: response.failureCode || null,
    attempts: response.attemptCount,
    latencyMs,
  });
  console.log(
    `${results.length}/${cases.length} ${item.id}: ${predicted.balanced.state}/${predicted.strict.state} (expected ${item.expected})`
  );
}

const summarize = (rows: any[], strictness: ClassifierStrictness) => {
  const state = (row: any): Label => row.predicted[strictness].state;
  const ok = (row: any) =>
    (row.expected === state(row) || row.acceptable.includes(state(row))) &&
    !row.predicted[strictness].wrongTarget;
  const count = (fn: (row: any) => boolean) => rows.filter(fn).length;
  const allows = (row: any, label: Label) =>
    row.expected === label || row.acceptable.includes(label);
  return {
    cases: rows.length,
    correct: count(ok),
    // Earns productive time it should not.
    falseFocused: count((row) => state(row) === 'focused' && !allows(row, 'focused')),
    // Raises a distraction alert on real work.
    falseAlarm: count((row) => state(row) === 'distracted' && row.expected === 'focused'),
    // Safe but unhelpful: real work left without credit.
    focusAbstained: count((row) => state(row) === 'uncertain' && row.expected === 'focused'),
    missedDistraction: count(
      (row) => row.expected === 'distracted' && state(row) !== 'distracted' && !ok(row)
    ),
    wrongTarget: count((row) => row.predicted[strictness].wrongTarget),
  };
};
const byCategory = (strictness: ClassifierStrictness) =>
  Object.fromEntries(
    [...new Set(results.map((row) => row.category))].sort().map((name) => [
      name,
      summarize(
        results.filter((row) => row.category === name),
        strictness
      ),
    ])
  );
const latencies = results.map((row) => row.latencyMs).sort((a, b) => a - b);
const quantile = (q: number) =>
  latencies.length ? latencies[Math.floor((latencies.length - 1) * q)] : null;
const summary = {
  split,
  model: process.env.OLLAMA_MODEL || 'qwen3:4b-instruct',
  technicalFailures: results.filter((row) => !row.decision).length,
  retried: results.filter((row) => row.attempts > 1).length,
  latencyMs: replayPath ? null : { p50: quantile(0.5), p95: quantile(0.95) },
  balanced: { overall: summarize(results, 'balanced'), byCategory: byCategory('balanced') },
  strict: { overall: summarize(results, 'strict'), byCategory: byCategory('strict') },
};
await Bun.write(
  output,
  JSON.stringify(
    {
      version: suite.version,
      policy: PERSONALIZED_POLICY_VERSION,
      evaluationMode: replayPath ? 'policy-replay' : 'live-local-model',
      summary,
      results,
    },
    null,
    2
  ) + '\n'
);
console.log(
  JSON.stringify(
    { ...summary, balanced: summary.balanced.overall, strict: summary.strict.overall },
    null,
    2
  )
);
for (const strictness of STRICTNESS) {
  console.log(`\n${strictness} by category (correct/cases, FF=false focused, FA=false alarm)`);
  for (const [name, row] of Object.entries(summary[strictness].byCategory) as Array<
    [string, ReturnType<typeof summarize>]
  >)
    console.log(
      `  ${name.padEnd(22)} ${String(row.correct).padStart(3)}/${String(row.cases).padEnd(3)} FF=${row.falseFocused} FA=${row.falseAlarm} abstain=${row.focusAbstained} missed=${row.missedDistraction}`
    );
}

const comparePath = arg('compare');
if (comparePath) {
  const previous = new Map<string, any>(
    (await Bun.file(comparePath).json()).results.map((row: any) => [row.id, row])
  );
  for (const strictness of STRICTNESS) {
    const changed = results.filter(
      (row) =>
        previous.has(row.id) &&
        previous.get(row.id).predicted[strictness].state !== row.predicted[strictness].state
    );
    console.log(`\n${strictness}: ${changed.length} changed predictions`);
    for (const row of changed)
      console.log(
        `  ${row.id}: ${previous.get(row.id).predicted[strictness].state} -> ${row.predicted[strictness].state} (expected ${row.expected})`
      );
  }
}
