/** Synthetic inputs only. Uses the configured localhost Ollama model; no database. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { localClassificationProvider } from '../src/services/categorization/provider';
const scenarios = [
  { ownerName: 'WhatsApp', title: 'WhatsApp', goal: 'Solve the statistical learning exercise sheet' },
  { ownerName: 'Firefox', title: 'YouTube — funny cat videos', goal: 'Finish the proof of the loop soundness theorem' },
  { ownerName: 'Steam', title: 'Steam Library', goal: 'Implement the reminder synchronization tests' },
  { ownerName: 'WhatsApp', title: 'WhatsApp', goal: 'Die Aufgaben zu linearen Regressionen lösen' },
];
const results = [];
for (const scenario of scenarios) {
  const started = performance.now();
  const copy = await localClassificationProvider.distractionNudge(scenario.goal, scenario);
  const latencyMs = Math.round(performance.now() - started);
  assert.ok(copy, 'Expected valid bounded notification copy for synthetic fixture: ' + scenario.ownerName);
  results.push({ ...scenario, ...copy, latencyMs });
  await Bun.sleep(250);
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
