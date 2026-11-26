import { OllamaClassificationProvider } from '../services/categorization/provider';

/**
 * Prints the goal profile the local model derives for each goal text, with the
 * app needs it implies. Goal text only; no database access.
 *
 *   bun run src/scripts/profileGoals.ts "Reply to the landlord" "Watch lecture 12"
 */
const goals = process.argv.slice(2);
if (!goals.length) throw new Error('Usage: profileGoals.ts <goal> [<goal> ...]');
const provider = new OllamaClassificationProvider();
for (const goal of goals) {
  const profile = await provider.profileGoal(goal);
  console.log(JSON.stringify({ goal, appNeeds: profile ? (profile.appNeeds ?? null) : 'failed' }));
}
