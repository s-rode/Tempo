import { OllamaClassificationProvider } from '../services/categorization/provider';
import { acceptsSemanticFocus } from '../services/categorization/classificationPolicy';
import {
  resolvePersonalizedPolicy,
  consolidatePreferences,
} from '../services/categorization/personalizedPolicy';
import fixtures from '../../evaluation/scenarios-v2.json';
import adversarial from '../../evaluation/adversarial-v2.json';

// No database access. All inputs are authored synthetic scenarios, never captured page text.
const provider = new OllamaClassificationProvider();
const output = process.argv[2] || '/tmp/tempo-classifier-baseline.json';
const candidate = process.argv.includes('--candidate');
const replayPath = process.argv.find((arg) => arg.startsWith('--replay='))?.slice(9);
const replayRows: any[] = replayPath ? (await Bun.file(replayPath).json()).results : [];
const results: any[] = [];
const cases: any[] = process.argv.includes('--adversarial') ? adversarial.cases : fixtures.cases;
const limit = Number(
  process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1] || cases.length
);
const selectedIds = process.argv
  .find((arg) => arg.startsWith('--ids='))
  ?.slice(6)
  .split(',');
for (const fixture of cases
  .filter((c) => !selectedIds || selectedIds.includes(c.id))
  .slice(0, limit)) {
  await new Promise((resolve) =>
    setTimeout(
      resolve,
      Number(process.argv.find((arg) => arg.startsWith('--pace-ms='))?.split('=')[1] || 250)
    )
  );
  const goals = {
    scope: 'session' as const,
    primaryGoal: fixture.goal,
    dailyTasks: [],
    targets: [
      {
        ref: 'session:test:held-out',
        scope: 'session' as const,
        text: fixture.goal,
        textFingerprint: fixture.id,
        supportProfile: {
          subjectCues: [fixture.domain],
          expectedOutcome: fixture.goal,
          supportingModes: [fixture.method as any],
          revision: 'fixture',
        },
      },
    ],
  };
  const examples =
    fixture.scenario === 'transfer' || fixture.learned
      ? [0, 1, 2].map((index) => ({
          id: `explicit-${index}`,
          state: 'focused' as const,
          toolLabel: fixture.app,
          pageKind: 'unknown',
          supportingMode: fixture.method,
          subjectCues: [fixture.domain],
          expectedOutcome: `Earlier ${fixture.domain} task ${index}`,
          supportingModes: [fixture.method],
          topicCues: [],
        }))
      : [];
  const started = performance.now();
  const replay = replayRows.find((r) => r.id === fixture.id);
  const response = replay
    ? { decision: replay.decision, failureCode: replay.failure, attemptCount: 1 }
    : await provider.decideActivity(
        goals,
        [
          { name: 'Work', isProductive: true },
          { name: 'Distraction', isProductive: false },
        ],
        {
          ownerName: fixture.app,
          title: fixture.title,
          type: fixture.browser ? 'browser' : 'window',
          browser: fixture.browser,
          content: fixture.content,
          siteHost: fixture.browser ? 'synthetic.invalid' : null,
        },
        'balanced',
        10_000,
        candidate ? [] : examples,
        candidate
      );
  let predicted = !response.decision
    ? 'uncertain'
    : acceptsSemanticFocus({
          decision: response.decision,
          strictness: 'balanced',
          hasFirefoxContent: Boolean(fixture.content),
        })
      ? 'focused'
      : 'distracted';
  if (candidate) {
    const target = {
      ref: 'session:test:held-out',
      taskKey: fixture.id,
      text: fixture.goal,
      classificationText: fixture.goal,
      listKey: fixture.domain,
      listName: fixture.domain,
      listContext: null,
      supportingModes: [fixture.method],
      profileRevision: 'fixture',
    };
    const now = Date.now();
    const actions =
      fixture.scenario === 'transfer' || fixture.learned
        ? [0, 1, 2].map((index) => ({
            actionId: `training-${index}`,
            userId: 'fixture',
            eventIds: [`earlier-${index}`],
            source: 'correction' as const,
            state: 'focused' as const,
            originalState: 'distracted' as const,
            toolKey: fixture.app,
            toolLabel: fixture.app,
            context: {
              ...target,
              listKey: fixture.trainingList || target.listKey,
              taskKey: `training-task-${index % 2}`,
            },
            sessionId: `training-session-${index % 2}`,
            supportingMode: fixture.trainingMethod || fixture.method,
            occurredAtMs: now - 86400000 * (index + 1),
            superseded: false,
          }))
        : [];
    const proposal = response.decision
      ? { ...response.decision, assessment: response.decision.assessment || ('opaque' as const) }
      : null;
    predicted = resolvePersonalizedPolicy({
      proposal,
      targets: [target],
      preferences: consolidatePreferences(actions, 'balanced', now),
      toolProfile: null,
      strictness: 'balanced',
      independentEvidence:
        fixture.title.toLowerCase() !== fixture.app.toLowerCase() &&
        Boolean(
          proposal?.evidenceAliases.some((alias: string) => alias === 'E2' || alias === 'E4')
        ),
      navigationAllowed: true,
    }).state;
  }
  results.push({
    id: fixture.id,
    expected: fixture.expected,
    predicted,
    scenario: fixture.scenario,
    decision: response.decision,
    failure: response.failureCode,
    latencyMs: replay?.latencyMs || Math.round(performance.now() - started),
  });
  await Bun.write(
    output,
    JSON.stringify(
      {
        version: 2,
        policy: candidate ? 'contextual-v2' : 'semantic-grounded-v1',
        evaluationMode: replayPath ? 'policy-replay' : 'live-local-model',
        results,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`${results.length}/${cases.length} ${fixture.id}: ${predicted}`);
}

const baselinePath = process.argv.find((arg) => arg.startsWith('--baseline='))?.split('=')[1];
if (candidate && baselinePath && !process.argv.includes('--adversarial')) {
  const baseline = (await Bun.file(baselinePath).json()).results;
  const count = (items: any[], fn: (x: any) => boolean) => items.filter(fn).length;
  const negative = (x: any) => x.expected === 'distracted';
  const nonFocused = (x: any) => x.expected !== 'focused';
  const positives = (x: any) => x.scenario === 'transfer';
  const before = count(baseline, (x) => positives(x) && x.predicted === 'distracted');
  const after = count(results, (x) => positives(x) && x.predicted === 'distracted');
  const gates = {
    noFalseProductiveRegression:
      count(results, (x) => nonFocused(x) && x.predicted === 'focused') <=
      count(baseline, (x) => nonFocused(x) && x.predicted === 'focused'),
    noDistractionRecallRegression:
      count(results, (x) => negative(x) && x.predicted === 'distracted') >=
      count(baseline, (x) => negative(x) && x.predicted === 'distracted'),
    clearDistractions: results.filter(negative).every((x) => x.predicted === 'distracted'),
    transferFalseAlarmsReduced: before > 0 ? after <= before * 0.75 : after === 0,
    transferUncertaintyNotIncreased:
      count(results, (x) => positives(x) && x.predicted === 'uncertain') <=
      count(baseline, (x) => positives(x) && x.predicted === 'uncertain'),
  };
  const times = (items: any[]) => items.map((x) => x.latencyMs).sort((a, b) => a - b);
  const summary = {
    gates,
    baselineTransferFalseAlarms: before,
    candidateTransferFalseAlarms: after,
    uncertain: count(results, (x) => x.predicted === 'uncertain'),
    falseProductive: count(results, (x) => nonFocused(x) && x.predicted === 'focused'),
    latencyMs: {
      baselineP95: times(baseline)[Math.floor(baseline.length * 0.95)],
      candidateP95: times(results)[Math.floor(results.length * 0.95)],
    },
  };
  console.log(JSON.stringify(summary, null, 2));
  await Bun.write(
    output.replace('.json', '-summary.json'),
    JSON.stringify(summary, null, 2) + '\n'
  );
  if (Object.values(gates).some((gate) => !gate)) process.exitCode = 1;
}

if (process.argv.includes('--adversarial')) {
  const failures = results.filter((x) => x.expected !== x.predicted);
  console.log(JSON.stringify({ cases: results.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}
