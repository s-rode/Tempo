export const SUPPORTING_MODES = [
  'calculation_or_visualization',
  'study_notes_or_retrieval',
  'read_reference',
  'coding_or_analysis',
  'drafting_or_problem_solving',
  'resource_navigation',
] as const;

export const GOAL_SUPPORT_PROFILE_POLICY_VERSION = 3;

/** Kinds of application a goal can itself call for. */
export const APP_NEEDS = ['communication', 'media'] as const;
export type AppNeed = (typeof APP_NEEDS)[number];

export type SupportingMode = (typeof SUPPORTING_MODES)[number];

export interface GoalSupportProfileData {
  subjectCues: string[];
  expectedOutcome: string;
  supportingModes: SupportingMode[];
  /** Applications the goal itself calls for; an empty list means it needs neither. */
  appNeeds?: AppNeed[];
  revision: string;
}

export const isSupportingMode = (value: unknown): value is SupportingMode =>
  typeof value === 'string' && (SUPPORTING_MODES as readonly string[]).includes(value);
