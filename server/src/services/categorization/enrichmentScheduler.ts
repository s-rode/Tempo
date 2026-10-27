import { cancelDistractionNudge } from './distractionNudgeRequests';
import { ActiveWindowDetails } from '../../../../shared/types';
import { ActiveWindowEventModel } from '../../models/activeWindowEvent';
import { CategoryModel } from '../../models/category';
import { getOrCreateRuntime, suspensionReasonsFor } from '../focusRuntime';
import { resolveGoalContext } from './categorizationService';
import { localClassificationProvider } from './provider';

type ActivityContext = Pick<
  ActiveWindowDetails,
  'ownerName' | 'title' | 'url' | 'siteHost' | 'content' | 'contentSource' | 'type' | 'browser'
>;

interface PendingEnrichment {
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  controller: AbortController;
  activity: ActivityContext;
}

const pendingByUser = new Map<string, PendingEnrichment>();
const generationByUser = new Map<string, number>();
const ENRICH_AFTER_STABLE_MS = 12_000;

const offGoalSummary = (value: string): string => {
  const detail =
    value.replace(/^off goal:\s*/i, '').trim() || 'This did not support the current goal.';
  return `Off goal: ${detail.slice(0, 70).trim()}`;
};

/** Called as soon as a newer capture exists, before it begins core inference. */
export function beginEnrichmentCapture(userId: string): number {
  cancelDistractionNudge(userId);
  cancelPendingEnrichment(userId);
  const next = (generationByUser.get(userId) || 0) + 1;
  generationByUser.set(userId, next);
  return next;
}

export function cancelPendingEnrichment(userId: string): void {
  const pending = pendingByUser.get(userId);
  if (!pending) return;
  if (pending.timer) clearTimeout(pending.timer);
  pending.controller.abort();
  // Release browser text rather than retaining it until garbage collection.
  pending.activity.content = null;
  pending.activity.siteHost = null;
  pending.activity.url = null;
  pendingByUser.delete(userId);
}

export function scheduleEnrichment(args: {
  userId: string;
  generation: number;
  eventId: string;
  timestamp: number;
  categoryId: string | null;
  goalContextFingerprint: string | null;
  activity: ActivityContext;
}): void {
  if (
    !args.categoryId ||
    !args.goalContextFingerprint ||
    generationByUser.get(args.userId) !== args.generation
  )
    return;
  const controller = new AbortController();
  const pending: PendingEnrichment = {
    generation: args.generation,
    timer: null,
    controller,
    activity: { ...args.activity },
  };
  pendingByUser.set(args.userId, pending);
  const delay = Math.max(0, ENRICH_AFTER_STABLE_MS - (Date.now() - args.timestamp));
  pending.timer = setTimeout(() => {
    void runEnrichment(args, pending);
  }, delay);
}

async function runEnrichment(
  args: Parameters<typeof scheduleEnrichment>[0],
  pending: PendingEnrichment
): Promise<void> {
  const stillCurrent = () =>
    pendingByUser.get(args.userId) === pending &&
    generationByUser.get(args.userId) === args.generation &&
    !pending.controller.signal.aborted;
  try {
    if (!stillCurrent()) return;
    const [latest, context, runtime, category] = await Promise.all([
      ActiveWindowEventModel.findOne({ userId: args.userId })
        .sort({ timestamp: -1 })
        .select('_id goalContextFingerprint categoryId')
        .lean(),
      resolveGoalContext(args.userId),
      getOrCreateRuntime(args.userId),
      CategoryModel.findById(args.categoryId).lean(),
    ]);
    if (
      !stillCurrent() ||
      String(latest?._id) !== args.eventId ||
      latest?.goalContextFingerprint !== args.goalContextFingerprint ||
      context.fingerprint !== args.goalContextFingerprint ||
      suspensionReasonsFor(runtime).length ||
      !category
    )
      return;
    const enrichment = await localClassificationProvider.enrich(
      context.goals,
      {
        name: category.name,
        description: category.description,
        isProductive: category.isProductive,
      },
      pending.activity,
      pending.controller.signal
    );
    if (!stillCurrent() || !enrichment) {
      if (stillCurrent() && !pending.controller.signal.aborted) {
        await ActiveWindowEventModel.updateOne(
          { _id: args.eventId, userId: args.userId, categoryId: args.categoryId },
          { $set: { classificationFailureCode: 'enrichment_failed' } }
        );
      }
      return;
    }
    const latestAfter = await ActiveWindowEventModel.findOne({ userId: args.userId })
      .sort({ timestamp: -1 })
      .select('_id')
      .lean();
    if (!stillCurrent() || String(latestAfter?._id) !== args.eventId) return;
    const metadata =
      category.isProductive === false
        ? {
            // Rich copy is deliberately unable to relabel a distraction as a
            // focus task. The summary is tagged so older unrestricted model
            // copy is never mistaken for an honest off-goal explanation.
            activityLabel: `Distracted by ${pending.activity.ownerName?.trim() || pending.activity.title?.trim() || 'this activity'}`,
            activitySummary: offGoalSummary(enrichment.activitySummary),
          }
        : {
            activityLabel: enrichment.activityLabel,
            activitySummary: enrichment.activitySummary,
            categoryReasoning: enrichment.reasoning,
          };
    await ActiveWindowEventModel.updateOne(
      {
        _id: args.eventId,
        userId: args.userId,
        categoryId: args.categoryId,
        goalContextFingerprint: args.goalContextFingerprint,
      },
      { $set: metadata }
    );
  } finally {
    pending.activity.content = null;
    pending.activity.siteHost = null;
    pending.activity.url = null;
    if (pendingByUser.get(args.userId) === pending) pendingByUser.delete(args.userId);
  }
}
