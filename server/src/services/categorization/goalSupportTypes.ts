export const SUPPORTING_MODES = [
  'calculation_or_visualization',
  'study_notes_or_retrieval',
  'read_reference',
  'coding_or_analysis',
  'drafting_or_problem_solving',
] as const;

export const GOAL_SUPPORT_PROFILE_POLICY_VERSION = 2;

export type SupportingMode = (typeof SUPPORTING_MODES)[number];

export interface GoalSupportProfileData {
  subjectCues: string[];
  expectedOutcome: string;
  supportingModes: SupportingMode[];
  revision: string;
}

export const isSupportingMode = (value: unknown): value is SupportingMode =>
  typeof value === 'string' && (SUPPORTING_MODES as readonly string[]).includes(value);
