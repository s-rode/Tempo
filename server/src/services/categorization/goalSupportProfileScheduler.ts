import crypto from 'crypto';
import { GoalSupportProfileModel } from '../../models/goalSupportProfile';
import type { EffectiveGoalContext, EffectiveGoalTarget } from '../goalPlans';
import { cancelPendingEnrichment } from './enrichmentScheduler';
import { localClassificationProvider } from './provider';
import { GOAL_SUPPORT_PROFILE_POLICY_VERSION, GoalSupportProfileData } from './goalSupportTypes';
const pendingByKey = new Map<
  string,
  { timer: ReturnType<typeof setTimeout> | null; controller: AbortController }
>();
const attemptedByKey = new Set<string>();

const profileKey = (userId: string, target: Pick<EffectiveGoalTarget, 'ref' | 'textFingerprint'>) =>
  `${userId}:${target.ref}:${target.textFingerprint}:${GOAL_SUPPORT_PROFILE_POLICY_VERSION}`;

const revisionFor = (profile: Pick<GoalSupportProfileData, 'subjectCues' | 'supportingModes'>) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        v: GOAL_SUPPORT_PROFILE_POLICY_VERSION,
        cues: profile.subjectCues,
        modes: profile.supportingModes,
      })
    )
    .digest('hex');

/** Core classification calls this before inference, so local goal profiling can never delay it. */
export function cancelPendingGoalSupportProfiles(userId: string): void {
  for (const [key, pending] of pendingByKey) {
    if (!key.startsWith(`${userId}:`)) continue;
    if (pending.timer) clearTimeout(pending.timer);
    pending.controller.abort();
    pendingByKey.delete(key);
  }
}

/**
 * Queue profiles only for active targets that do not already have the exact
 * current text/policy version. This work is deliberately best effort.
 */
export function ensureGoalSupportProfiles(userId: string, context: EffectiveGoalContext): void {
  for (const target of context.targets || []) {
    if (target.supportProfile) continue;
    const key = profileKey(userId, target);
    if (pendingByKey.has(key) || attemptedByKey.has(key)) continue;
    const controller = new AbortController();
    const pending = { timer: null as ReturnType<typeof setTimeout> | null, controller };
    pendingByKey.set(key, pending);
    pending.timer = setTimeout(() => {
      pending.timer = null;
      void createProfile(userId, target, key, pending);
    }, 180);
  }
}

async function createProfile(
  userId: string,
  target: EffectiveGoalTarget,
  key: string,
  pending: { timer: ReturnType<typeof setTimeout> | null; controller: AbortController }
): Promise<void> {
  try {
    if (pending.controller.signal.aborted) return;
    // A profile is more useful than rich copy but never more important than a
    // live decision. Cancelling enrichment also releases retained OCR text.
    cancelPendingEnrichment(userId);
    const result = await localClassificationProvider.profileGoal(
      target.text,
      pending.controller.signal
    );
    if (!result || pending.controller.signal.aborted) return;
    const normalized = {
      subjectCues: result.subjectCues.slice(0, 6),
      supportingModes: result.supportingModes.slice(0, 5),
    };
    await GoalSupportProfileModel.updateOne(
      {
        userId,
        goalRef: target.ref,
        goalTextFingerprint: target.textFingerprint,
        policyVersion: GOAL_SUPPORT_PROFILE_POLICY_VERSION,
      },
      {
        $set: {
          subjectCues: normalized.subjectCues,
          supportingModes: normalized.supportingModes,
          revision: revisionFor(normalized),
        },
        $setOnInsert: {
          userId,
          goalRef: target.ref,
          goalTextFingerprint: target.textFingerprint,
          policyVersion: GOAL_SUPPORT_PROFILE_POLICY_VERSION,
        },
      },
      { upsert: true }
    );
  } finally {
    // An unavailable local model should not cause a profile request on every
    // activity sample. A goal-text change creates a new key and retries once.
    if (!pending.controller.signal.aborted) attemptedByKey.add(key);
    if (pendingByKey.get(key) === pending) pendingByKey.delete(key);
  }
}
