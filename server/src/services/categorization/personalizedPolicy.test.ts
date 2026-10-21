import { describe, test, expect } from 'bun:test';
import {
  consolidatePreferences,
  resolvePersonalizedPolicy,
  NavigationAllowance,
  preferenceIdentity,
} from './personalizedPolicy';
import type { CorrectionAction } from '../../models/correctionAction';
import type { HistoricalGoalTarget, SemanticProposal } from '../../../../shared/classification';
const now = 1800000000000,
  day = 86400000;
const target: HistoricalGoalTarget = {
  ref: 'T1',
  taskKey: 'held-out',
  text: 'Study topology',
  classificationText: 'Study topology',
  listKey: 'university',
  listName: 'Courses',
  listContext: 'University coursework',
  supportingModes: ['study_notes_or_retrieval'],
  profileRevision: 'v1',
};
const actions = (count = 3): CorrectionAction[] =>
  Array.from({ length: count }, (_, i) => ({
    actionId: `a${i}`,
    userId: 'u',
    eventIds: [`e${i}`],
    source: 'correction',
    state: 'focused',
    originalState: 'distracted',
    toolKey: 'tool',
    toolLabel: 'Unknown study assistant',
    context: { ...target, taskKey: `earlier-${i % 2}` },
    sessionId: `s${i % 2}`,
    supportingMode: 'study_notes_or_retrieval',
    occurredAtMs: now - day * (i + 1),
    superseded: false,
  }));
const proposal: SemanticProposal = {
  assessment: 'opaque',
  state: 'uncertain',
  relation: 'none',
  confidence: 'medium',
  matchedGoalRef: 'T1',
  supportingMode: 'study_notes_or_retrieval',
  evidenceAliases: ['E1', 'E2'],
};
const resolve = (changes: Partial<Parameters<typeof resolvePersonalizedPolicy>[0]> = {}) =>
  resolvePersonalizedPolicy({
    proposal,
    targets: [target],
    preferences: consolidatePreferences(actions(), 'balanced', now),
    toolProfile: null,
    strictness: 'balanced',
    independentEvidence: false,
    navigationAllowed: false,
    ...changes,
  });

describe('bounded explicit personal learning', () => {
  test('three actions across tasks and sessions establish Balanced list trust', () => {
    const result = resolve();
    expect(result.state).toBe('focused');
    expect(result.basis).toBe('list_preference');
  });
  test('does not promote duplicate events or a single repeated action', () => {
    const repeated = Array.from({ length: 30 }, () => actions(1)[0]);
    expect(consolidatePreferences(repeated, 'balanced', now).some((p) => p.scope === 'list')).toBe(
      false
    );
  });
  test('one action split across historical contexts is still one positive action', () => {
    const values = actions(8).map((a) => ({ ...a, rootActionId: 'one-user-action' }));
    expect(consolidatePreferences(values, 'balanced', now).some((p) => p.scope === 'list')).toBe(
      false
    );
  });
  test('a concrete distraction verdict is not silenced by low self-reported confidence', () => {
    expect(
      resolve({
        proposal: {
          ...proposal,
          assessment: 'conflicting',
          state: 'distracted',
          confidence: 'low',
        },
        independentEvidence: true,
      }).state
    ).toBe('distracted');
  });
  test('requires distinct tasks and sessions, not just many positives', () => {
    for (const values of [
      actions(9).map((a) => ({ ...a, sessionId: 'one' })),
      actions(9).map((a) => ({ ...a, context: { ...a.context, taskKey: 'one' } })),
    ])
      expect(consolidatePreferences(values, 'balanced', now).some((p) => p.scope === 'list')).toBe(
        false
      );
  });
  test('keeps strictness thresholds distinct', () => {
    expect(
      consolidatePreferences(actions(2), 'flexible', now).some((p) => p.scope === 'list')
    ).toBe(true);
    expect(
      consolidatePreferences(actions(2), 'balanced', now).some((p) => p.scope === 'list')
    ).toBe(false);
    expect(consolidatePreferences(actions(3), 'strict', now).some((p) => p.scope === 'list')).toBe(
      false
    );
  });
  test('never transfers to another list or an incompatible work method', () => {
    expect(resolve({ targets: [{ ...target, listKey: 'household' }] }).state).toBe('uncertain');
    expect(
      resolve({ targets: [{ ...target, supportingModes: ['coding_or_analysis'] }] }).state
    ).toBe('uncertain');
  });
  test('visible unrelated work defeats any amount of positive history', () => {
    expect(
      resolve({
        proposal: { ...proposal, assessment: 'conflicting', state: 'distracted' },
        independentEvidence: true,
      }).state
    ).toBe('distracted');
  });
  test('one negative suspends broad trust and later positives cannot drown it out', () => {
    const values = [
      ...actions(12),
      {
        ...actions(1)[0],
        actionId: 'negative',
        state: 'distracted' as const,
        occurredAtMs: now - 20 * day,
      },
    ];
    const preferences = consolidatePreferences(values, 'balanced', now);
    expect(resolve({ preferences }).state).toBe('uncertain');
    const id = preferenceIdentity('tool', 'list', 'university', 'study_notes_or_retrieval');
    const reinstated = consolidatePreferences(values, 'balanced', now, [
      { preferenceId: id, state: 'active', changedAtMs: now - day },
    ]);
    expect(resolve({ preferences: reinstated }).state).toBe('focused');
  });
  test('superseded feedback stops contributing without losing history', () => {
    const values = actions().map((a) => ({ ...a, superseded: true }));
    expect(consolidatePreferences(values, 'balanced', now)).toEqual([]);
    expect(values).toHaveLength(3);
  });
  test('old explicit evidence expires and ordinary time cannot renew it', () => {
    expect(consolidatePreferences(actions(), 'balanced', now + 91 * day)).toEqual([]);
  });
  test('without evidence, generic apps stay uncertain even if the title repeats the app', () => {
    expect(resolve({ preferences: [] }).state).toBe('uncertain');
    expect(
      resolve({
        proposal: { ...proposal, assessment: 'relevant', state: 'focused', confidence: 'high' },
        preferences: [],
      }).state
    ).toBe('uncertain');
  });
  test('compatible specialized capability is useful but cannot override contradictions', () => {
    const toolProfile = {
      role: 'specialized' as const,
      supportingModes: ['study_notes_or_retrieval'],
      revision: 'v1',
    };
    expect(resolve({ preferences: [], toolProfile }).basis).toBe('tool_role');
    expect(
      resolve({
        toolProfile,
        proposal: { ...proposal, assessment: 'conflicting', state: 'distracted' },
      }).state
    ).toBe('distracted');
  });
  test('technical failures remain neutral despite a strong preference', () => {
    expect(resolve({ proposal: null }).basis).toBe('technical_failure');
    expect(resolve({ proposal: null }).state).toBe('uncertain');
  });
  test('dashboard captures cannot renew the navigation allowance', () => {
    const episodes = new NavigationAllowance();
    expect(episodes.allows('u:tool:task', now)).toBe(true);
    expect(episodes.allows('u:tool:task', now + 59000)).toBe(true);
    expect(episodes.allows('u:tool:task', now + 60000)).toBe(false);
    expect(episodes.allows('u:tool:task', now + 90000)).toBe(false);
    episodes.confirm('u:tool:task');
    expect(episodes.allows('u:tool:task', now + 90001)).toBe(true);
  });
});
