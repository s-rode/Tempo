/** Bounded user-authored goal provenance; never contains captured activity content. */
export interface HistoricalGoalTarget {
  ref: string;
  taskKey: string;
  text: string;
  classificationText: string;
  listKey: string | null;
  listName: string | null;
  listContext: string | null;
  supportingModes: string[];
  profileRevision: string | null;
}

export interface ClassificationContextSnapshot {
  version: 2;
  scope: 'session' | 'daily' | 'weekly' | 'none';
  sessionId: string | null;
  targets: HistoricalGoalTarget[];
}

export type ClassificationBasis =
  | 'manual'
  | 'visible_relevance'
  | 'visible_conflict'
  | 'task_preference'
  | 'list_preference'
  | 'tool_role'
  | 'resource_navigation'
  | 'insufficient_evidence'
  | 'policy_rejected'
  | 'technical_failure';

export interface SemanticProposal {
  assessment: 'relevant' | 'conflicting' | 'opaque';
  state: 'focused' | 'distracted' | 'uncertain';
  relation: 'direct' | 'supporting' | 'none';
  confidence: 'high' | 'medium' | 'low';
  matchedGoalRef: string | null;
  supportingMode: string | null;
  evidenceAliases: string[];
}

export interface ToolCapabilityProfile {
  role: 'specialized' | 'general_purpose' | 'unknown';
  supportingModes: string[];
  revision: string;
}

export interface PersonalizedEventMetadata {
  goalSnapshot?: ClassificationContextSnapshot | null;
  classificationBasis?: ClassificationBasis | null;
  semanticProposal?: SemanticProposal | null;
  preferenceId?: string | null;
  decisionExpiresAtMs?: number | null;
}
