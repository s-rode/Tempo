import { afterEach, describe, expect, jest, mock, test } from 'bun:test';
import type { EffectiveGoalContext } from '../goalPlans';

const profiles = { updateOne: jest.fn() };
const provider = { profileGoal: jest.fn() };
const enrichment = { cancelPendingEnrichment: jest.fn() };

mock.module('../../models/goalSupportProfile', () => ({ GoalSupportProfileModel: profiles }));
mock.module('./provider', () => ({ localClassificationProvider: provider }));
mock.module('./enrichmentScheduler', () => enrichment);

const { cancelPendingGoalSupportProfiles, ensureGoalSupportProfiles } = await import(
  './goalSupportProfileScheduler'
);

const context = (suffix: string): EffectiveGoalContext => ({
  scope: 'daily',
  primaryGoal: 'Solve the machine learning exercise sheet',
  dailyTasks: ['Solve the machine learning exercise sheet'],
  attentionGuardrail: null,
  targets: [
    {
      ref: `daily:2026-09-09:${suffix}`,
      scope: 'daily',
      text: 'Solve the machine learning exercise sheet',
      textFingerprint: `goal-${suffix}`,
      supportProfile: null,
    },
  ],
});

const waitForProfileSlot = () => Bun.sleep(220);

describe('goal support profile scheduler', () => {
  afterEach(() => {
    cancelPendingGoalSupportProfiles('profile-test-a');
    cancelPendingGoalSupportProfiles('profile-test-b');
    jest.clearAllMocks();
  });

  test('cancels queued low-priority profiling before it can reach Ollama', async () => {
    ensureGoalSupportProfiles('profile-test-a', context('queued'));
    cancelPendingGoalSupportProfiles('profile-test-a');
    await waitForProfileSlot();
    expect(provider.profileGoal).not.toHaveBeenCalled();
  });

  test('persists only a bounded profile from the goal and releases enrichment priority', async () => {
    provider.profileGoal.mockResolvedValue({
      subjectCues: ['machine learning', 'exercise problems'],
      expectedOutcome: 'Complete the exercise sheet.',
      supportingModes: ['calculation_or_visualization'],
      revision: '',
    });
    ensureGoalSupportProfiles('profile-test-b', context('persisted'));
    await waitForProfileSlot();

    expect(provider.profileGoal).toHaveBeenCalledWith(
      'Solve the machine learning exercise sheet',
      expect.any(AbortSignal)
    );
    expect(enrichment.cancelPendingEnrichment).toHaveBeenCalledWith('profile-test-b');
    expect(profiles.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'profile-test-b',
        goalRef: 'profile:goal-persisted',
        goalTextFingerprint: 'goal-persisted',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          subjectCues: ['machine learning', 'exercise problems'],
          expectedOutcome: 'Complete the exercise sheet.',
          supportingModes: ['calculation_or_visualization'],
        }),
      }),
      { upsert: true }
    );
    const persisted = profiles.updateOne.mock.calls[0][1].$set;
    expect(Object.keys(persisted).sort()).toEqual([
      'expectedOutcome',
      'revision',
      'subjectCues',
      'supportingModes',
    ]);
  });
});
