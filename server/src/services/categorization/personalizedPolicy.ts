import type { ClassifierStrictness } from '../../../../shared/types';
import type {
  ClassificationBasis,
  HistoricalGoalTarget,
  SemanticProposal,
  ToolCapabilityProfile,
} from '../../../../shared/classification';
import type { CorrectionAction } from '../../models/correctionAction';

export const PERSONALIZED_POLICY_VERSION = 'contextual-v2';
export const PROMOTION_REQUIREMENTS = {
  flexible: { actions: 2, sessions: 2, tasks: 2 },
  balanced: { actions: 3, sessions: 2, tasks: 2 },
  strict: { actions: 5, sessions: 3, tasks: 3 },
} as const;
const DAY = 86400000;
export const preferenceIdentity = (
  toolKey: string,
  scope: 'task' | 'list',
  key: string,
  mode: string | null
) => `${scope}:${toolKey}:${key}:${mode || 'contextual'}`;

export interface ScopedPreference {
  id: string;
  scope: 'task' | 'list';
  key: string;
  state: 'focused' | 'distracted';
  supportingMode: string | null;
  actions: number;
  sessions: number;
  tasks: number;
  lastExplicitAtMs: number;
  expiresAtMs: number;
  conflicted: boolean;
  toolLabel: string;
}
export interface PreferenceControl {
  preferenceId: string;
  state: 'suspended' | 'removed' | 'active';
  changedAtMs: number;
}

/** Feedback is selection-biased. Counts establish workflow eligibility, never a success probability. */
export function consolidatePreferences(
  actions: CorrectionAction[],
  strictness: ClassifierStrictness,
  now: number,
  controls: PreferenceControl[] = []
): ScopedPreference[] {
  const active = actions.filter((a) => !a.superseded && a.occurredAtMs <= now);
  const groups = new Map<string, CorrectionAction[]>();
  for (const action of active) {
    const keys: Array<['task' | 'list', string]> = [['task', action.context.taskKey]];
    if (action.context.listKey) keys.push(['list', action.context.listKey]);
    for (const [scope, key] of keys) {
      const id = preferenceIdentity(action.toolKey, scope, key, action.supportingMode);
      groups.set(id, [...(groups.get(id) || []), action]);
    }
  }
  const result: ScopedPreference[] = [];
  for (const [id, groupRecords] of groups) {
    const control = controls.find((c) => c.preferenceId === id);
    const records =
      control?.state === 'removed'
        ? groupRecords.filter((a) => a.occurredAtMs > control.changedAtMs)
        : groupRecords;
    if (!records.length) continue;
    records.sort((a, b) => b.occurredAtMs - a.occurredAtMs || b.actionId.localeCompare(a.actionId));
    const first = records[0],
      scope = id.startsWith('list:') ? 'list' : 'task';
    const positive = records.filter(
      (a) => a.state === 'focused' && a.occurredAtMs >= now - 60 * DAY
    );
    const unique = [...new Map(positive.map((a) => [a.rootActionId || a.actionId, a])).values()];
    const sessions = new Set(unique.map((a) => a.sessionId).filter(Boolean)).size;
    const tasks = new Set(unique.map((a) => a.context.taskKey)).size;
    const required = PROMOTION_REQUIREMENTS[strictness];
    if (
      scope === 'list' &&
      (!first.supportingMode ||
        unique.length < required.actions ||
        sessions < required.sessions ||
        tasks < required.tasks)
    )
      continue;
    const key = scope === 'list' ? first.context.listKey! : first.context.taskKey;
    // Any explicit negative for this tool/list suspends opaque broad trust, including negatives in another method.
    const negatives = actions.filter(
      (a) =>
        !a.forgotten &&
        a.state === 'distracted' &&
        a.toolKey === first.toolKey &&
        (scope === 'list' ? a.context.listKey === key : a.context.taskKey === key)
    );
    const conflicted =
      control?.state === 'suspended' ||
      (scope === 'list' &&
        negatives.some(
          (a) =>
            a.occurredAtMs >
            (control?.state === 'active' || control?.state === 'removed'
              ? control.changedAtMs
              : -Infinity)
        ));
    const lastExplicitAtMs =
      scope === 'list' ? Math.max(...positive.map((a) => a.occurredAtMs)) : first.occurredAtMs;
    const expiresAtMs =
      scope === 'list'
        ? Math.min(lastExplicitAtMs + 90 * DAY, ...positive.map((a) => a.occurredAtMs + 60 * DAY))
        : lastExplicitAtMs + 90 * DAY;
    if (expiresAtMs <= now) continue;
    result.push({
      id,
      scope,
      key,
      state: scope === 'list' ? 'focused' : first.state,
      supportingMode: first.supportingMode,
      actions: scope === 'list' ? unique.length : records.length,
      sessions,
      tasks,
      lastExplicitAtMs,
      expiresAtMs,
      conflicted,
      toolLabel: first.toolLabel,
    });
  }
  return result.sort(
    (a, b) =>
      (a.scope === 'task' ? 0 : 1) - (b.scope === 'task' ? 0 : 1) ||
      b.lastExplicitAtMs - a.lastExplicitAtMs
  );
}

export interface PersonalizedResolution {
  state: 'focused' | 'distracted' | 'uncertain';
  basis: ClassificationBasis;
  target: HistoricalGoalTarget | null;
  preference: ScopedPreference | null;
}
export function resolvePersonalizedPolicy(input: {
  proposal: SemanticProposal | null;
  targets: HistoricalGoalTarget[];
  preferences: ScopedPreference[];
  toolProfile: ToolCapabilityProfile | null;
  strictness: ClassifierStrictness;
  independentEvidence: boolean;
  navigationAllowed: boolean;
}): PersonalizedResolution {
  const { proposal, targets } = input;
  const result = (
    state: PersonalizedResolution['state'],
    basis: ClassificationBasis,
    target: HistoricalGoalTarget | null = null,
    preference: ScopedPreference | null = null
  ): PersonalizedResolution => ({ state, basis, target, preference });
  if (!proposal) return result('uncertain', 'technical_failure');
  const unsupportedConflict =
    proposal.assessment === 'conflicting' &&
    (proposal.evidenceAliases.length === 0 ||
      (!input.independentEvidence && input.toolProfile?.role !== 'specialized'));
  const assessment =
    (proposal.assessment === 'relevant' && !input.independentEvidence) || unsupportedConflict
      ? 'opaque'
      : proposal.assessment;
  if (assessment === 'conflicting') return result('distracted', 'visible_conflict');
  const target =
    targets.find((t) => t.ref === proposal.matchedGoalRef) ||
    (targets.length === 1 ? targets[0] : null);
  if (!target) return result('uncertain', 'insufficient_evidence');
  const compatible = (p: ScopedPreference) =>
    p.supportingMode === null || target.supportingModes.includes(p.supportingMode);
  const applicable = input.preferences.filter(
    (p) =>
      (p.scope === 'task'
        ? p.key === target.taskKey
        : Boolean(target.listKey) && p.key === target.listKey) && compatible(p)
  );
  const task = applicable.find((p) => p.scope === 'task');
  if (task?.state === 'distracted' && !task.conflicted)
    return result('distracted', 'task_preference', target, task);
  const preference = task?.conflicted
    ? undefined
    : applicable.find((p) => p.state === 'focused' && !p.conflicted);
  if (
    assessment === 'relevant' &&
    input.independentEvidence &&
    proposal.confidence !== 'low' &&
    (input.strictness !== 'strict' || proposal.confidence === 'high')
  ) {
    if (proposal.supportingMode === 'resource_navigation')
      return input.navigationAllowed
        ? result('focused', 'resource_navigation', target)
        : result('uncertain', 'insufficient_evidence', target);
    return result('focused', 'visible_relevance', target);
  }
  if (assessment === 'opaque' && preference)
    return result(
      'focused',
      preference.scope === 'task' ? 'task_preference' : 'list_preference',
      target,
      preference
    );
  const role = input.toolProfile;
  if (
    assessment === 'opaque' &&
    role?.role === 'specialized' &&
    input.strictness !== 'strict' &&
    role.supportingModes.some(
      (mode) => mode !== 'resource_navigation' && target.supportingModes.includes(mode)
    )
  )
    return result('focused', 'tool_role', target);
  return result(
    'uncertain',
    assessment === 'relevant' ? 'policy_rejected' : 'insufficient_evidence',
    target
  );
}

/** Deadline belongs to the tool/task episode, not to captures or cache hits. */
export class NavigationAllowance {
  private episodes = new Map<string, number>();
  allows(key: string, now: number): boolean {
    let started = this.episodes.get(key);
    if (started === undefined) {
      started = now;
      this.episodes.set(key, started);
    }
    return now - started < 60_000;
  }
  confirm(key: string): void {
    this.episodes.delete(key);
  }
  clearUser(userId: string): void {
    for (const key of this.episodes.keys())
      if (key.startsWith(`${userId}:`)) this.episodes.delete(key);
  }
}
