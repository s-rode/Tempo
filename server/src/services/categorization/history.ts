import type { PersonalizedEventMetadata } from '../../../../shared/classification';
import { ActiveWindowDetails } from '../../../../shared/types';
import { ActiveWindowEventModel } from '../../models/activeWindowEvent';
import { activityKeyFor, fingerprintCapturedContent } from './activityIdentity';

export { fingerprintCapturedContent } from './activityIdentity';

export interface HistoricalClassification extends PersonalizedEventMetadata {
  categoryId: string;
  categoryReasoning?: string | null;
  activityLabel?: string | null;
  activitySummary?: string | null;
  nudgeTitle?: string | null;
  nudgeBody?: string | null;
  goalRelation?: 'direct' | 'supporting' | 'none' | 'insufficient' | null;
  supportingMode?: string | null;
  pageDescriptorRevision?: string | null;
  pageKind?: string | null;
  evidenceQuality?: 'strong' | 'partial' | 'weak' | null;
  decisionConfidence?: 'high' | 'medium' | 'low' | null;
  matchedGoalRef?: string | null;
}

const HISTORY_SELECT =
  'goalSnapshot classificationBasis semanticProposal preferenceId decisionExpiresAtMs categoryId categoryReasoning activityLabel activitySummary nudgeTitle nudgeBody goalRelation supportingMode pageDescriptorRevision pageKind evidenceQuality decisionConfidence matchedGoalRef';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toHistoricalClassification(row: any): HistoricalClassification {
  return {
    categoryId: row.categoryId as string,
    goalSnapshot: row.goalSnapshot,
    classificationBasis: row.classificationBasis,
    semanticProposal: row.semanticProposal,
    preferenceId: row.preferenceId,
    decisionExpiresAtMs: row.decisionExpiresAtMs,
    categoryReasoning: row.categoryReasoning as string | null | undefined,
    activityLabel: row.activityLabel as string | null | undefined,
    activitySummary: row.activitySummary as string | null | undefined,
    nudgeTitle: row.nudgeTitle as string | null | undefined,
    nudgeBody: row.nudgeBody as string | null | undefined,
    goalRelation: row.goalRelation as HistoricalClassification['goalRelation'],
    supportingMode: row.supportingMode as string | null | undefined,
    pageDescriptorRevision: row.pageDescriptorRevision as string | null | undefined,
    pageKind: row.pageKind as string | null | undefined,
    evidenceQuality: row.evidenceQuality as HistoricalClassification['evidenceQuality'],
    decisionConfidence: row.decisionConfidence as HistoricalClassification['decisionConfidence'],
    matchedGoalRef: row.matchedGoalRef as string | null | undefined,
  };
}

export async function checkActivityHistory(
  userId: string,
  activeWindow: Pick<
    ActiveWindowDetails,
    'ownerName' | 'url' | 'type' | 'title' | 'browser' | 'content'
  >,
  classificationContextFingerprint: string
): Promise<HistoricalClassification | null> {
  try {
    const contentFingerprint = fingerprintCapturedContent(activeWindow.content);
    if (activeWindow.browser === 'firefox' && !contentFingerprint) return null;
    const activityKey = activityKeyFor(activeWindow, contentFingerprint);
    if (!activityKey) return null;
    // Never reuse an application-wide decision. In particular, a productive
    // Mail/PDF event may not classify a different subject or filename.
    const queryCondition = {
      userId,
      activityKey,
      $and: [
        { $or: [{ decisionExpiresAtMs: null }, { decisionExpiresAtMs: { $gt: Date.now() } }] },
      ],
      classificationContextFingerprint,
      classificationStatus: { $in: ['deterministic_direct', 'ollama', 'policy_override'] },
      $or: [
        { classificationStatus: 'deterministic_direct' },
        {
          classificationStatus: 'policy_override',
          decisionConfidence: { $in: ['high', 'medium'] },
          learningExampleId: { $ne: null },
        },
        {
          decisionConfidence: { $in: ['high', 'medium'] },
          evidenceQuality: { $in: ['strong', 'partial'] },
        },
      ],
    };

    const lastEventWithSameIdentifier = await ActiveWindowEventModel.findOne(queryCondition)
      .sort({ timestamp: -1 })
      .select(HISTORY_SELECT)
      .lean();

    if (lastEventWithSameIdentifier && lastEventWithSameIdentifier.categoryId) {
      return toHistoricalClassification(lastEventWithSameIdentifier);
    }
  } catch (error) {
    console.error('[CategorizationService] Error during history check: details withheld to protect activity context.');
  }
  return null;
}

/** A model decision is reused for the same Firefox page for at most this long. */
export const RECENT_PAGE_DECISION_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Firefox page text changes slightly between captures of the same page (feeds,
 * counters, streamed text), which defeats the exact content-fingerprint history
 * above even though the page and title are unchanged. Reuse the latest
 * model-made, resolved decision for the same page and title in the same
 * classification context for a fixed window, then ask the model again.
 *
 * Only decisions the model itself made are eligible (status `ollama`), so a
 * reused event, which is stored as `history`, can never extend the window, and
 * only resolved relevance/conflict outcomes are reused: uncertain results and
 * time-limited policy outcomes are always recomputed.
 */
export async function findRecentPageDecision(
  userId: string,
  page: { pageCorrectionKey: string | null; title: string; browser?: string | null },
  classificationContextFingerprint: string,
  nowMs: number = Date.now()
): Promise<HistoricalClassification | null> {
  if (page.browser !== 'firefox' || !page.pageCorrectionKey) return null;
  try {
    const row = await ActiveWindowEventModel.findOne({
      userId,
      pageCorrectionKey: page.pageCorrectionKey,
      title: page.title,
      classificationContextFingerprint,
      classificationStatus: 'ollama',
      classificationBasis: { $in: ['visible_relevance', 'visible_conflict'] },
      categoryId: { $ne: null },
      timestamp: { $gte: nowMs - RECENT_PAGE_DECISION_MAX_AGE_MS },
    })
      .sort({ timestamp: -1 })
      .select(HISTORY_SELECT)
      .lean();
    return row?.categoryId ? toHistoricalClassification(row) : null;
  } catch {
    console.error('[CategorizationService] Error during page reuse check: details withheld to protect activity context.');
    return null;
  }
}
