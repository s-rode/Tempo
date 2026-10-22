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
      .select(
        'goalSnapshot classificationBasis semanticProposal preferenceId decisionExpiresAtMs categoryId categoryReasoning activityLabel activitySummary nudgeTitle nudgeBody goalRelation supportingMode pageDescriptorRevision pageKind evidenceQuality decisionConfidence matchedGoalRef'
      )
      .lean();

    if (lastEventWithSameIdentifier && lastEventWithSameIdentifier.categoryId) {
      return {
        categoryId: lastEventWithSameIdentifier.categoryId as string,
        goalSnapshot: lastEventWithSameIdentifier.goalSnapshot,
        classificationBasis: lastEventWithSameIdentifier.classificationBasis,
        semanticProposal: lastEventWithSameIdentifier.semanticProposal,
        preferenceId: lastEventWithSameIdentifier.preferenceId,
        decisionExpiresAtMs: lastEventWithSameIdentifier.decisionExpiresAtMs,
        categoryReasoning: lastEventWithSameIdentifier.categoryReasoning as
          | string
          | null
          | undefined,
        activityLabel: lastEventWithSameIdentifier.activityLabel as string | null | undefined,
        activitySummary: lastEventWithSameIdentifier.activitySummary as string | null | undefined,
        nudgeTitle: lastEventWithSameIdentifier.nudgeTitle as string | null | undefined,
        nudgeBody: lastEventWithSameIdentifier.nudgeBody as string | null | undefined,
        goalRelation:
          lastEventWithSameIdentifier.goalRelation as HistoricalClassification['goalRelation'],
        supportingMode: lastEventWithSameIdentifier.supportingMode as string | null | undefined,
        pageDescriptorRevision: lastEventWithSameIdentifier.pageDescriptorRevision as
          | string
          | null
          | undefined,
        pageKind: lastEventWithSameIdentifier.pageKind as string | null | undefined,
        evidenceQuality:
          lastEventWithSameIdentifier.evidenceQuality as HistoricalClassification['evidenceQuality'],
        decisionConfidence:
          lastEventWithSameIdentifier.decisionConfidence as HistoricalClassification['decisionConfidence'],
        matchedGoalRef: lastEventWithSameIdentifier.matchedGoalRef as string | null | undefined,
      };
    }
  } catch (error) {
    console.error('[CategorizationService] Error during history check: details withheld to protect activity context.');
  }
  return null;
}
