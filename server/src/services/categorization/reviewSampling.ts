import type { ActiveWindowEvent } from '../../../../shared/types';
export interface ReviewBlock {
  eventIds: string[];
  startedAtMs: number;
  ownerName: string;
  title: string;
  goal: string;
  basis: string;
  stratum: 'random' | 'learned' | 'tool_role';
  population: number;
  inclusionProbability: number;
}
/** Sample contiguous activity blocks, not capture frequency. Keep the random and targeted strata separate. */
export function sampleProductiveBlocks(
  events: ActiveWindowEvent[],
  productiveIds: Set<string>,
  random = Math.random
): ReviewBlock[] {
  const blocks: ReviewBlock[] = [];
  let previous: ActiveWindowEvent | null = null;
  for (const event of events) {
    const eligible = Boolean(
      event.eventId &&
        event.categoryId &&
        productiveIds.has(event.categoryId) &&
        event.classificationBasis &&
        !['manual', 'technical_failure'].includes(event.classificationBasis) &&
        !String(event.classificationStatus).startsWith('manual')
    );
    const last = blocks[blocks.length - 1];
    const same =
      eligible &&
      previous &&
      last &&
      previous.ownerName === event.ownerName &&
      previous.title === event.title &&
      previous.goalContextFingerprint === event.goalContextFingerprint &&
      event.timestamp! - previous.timestamp! < 120_000;
    if (same) last.eventIds.push(event.eventId!);
    else if (eligible)
      blocks.push({
        eventIds: [event.eventId!],
        startedAtMs: Number(event.timestamp),
        ownerName: event.ownerName,
        title: event.title,
        goal:
          event.goalSnapshot?.targets.find((t) => t.ref === event.matchedGoalRef)?.text ||
          event.goalSnapshot?.targets[0]?.text ||
          '',
        basis: event.classificationBasis!,
        stratum: 'random',
        population: 0,
        inclusionProbability: 0,
      });
    previous = eligible ? event : null;
  }
  if (!blocks.length) return [];
  const picked: ReviewBlock[] = [];
  const choose = (candidates: ReviewBlock[], stratum: ReviewBlock['stratum']) => {
    if (!candidates.length) return;
    const item =
      candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
    picked.push({
      ...item,
      stratum,
      population: candidates.length,
      inclusionProbability: 1 / candidates.length,
    });
  };
  choose(blocks, 'random');
  choose(
    blocks.filter(
      (b) =>
        !picked.some((p) => p.eventIds[0] === b.eventIds[0]) &&
        ['list_preference', 'task_preference'].includes(b.basis)
    ),
    'learned'
  );
  choose(
    blocks.filter(
      (b) => !picked.some((p) => p.eventIds[0] === b.eventIds[0]) && b.basis === 'tool_role'
    ),
    'tool_role'
  );
  return picked;
}
