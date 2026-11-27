import type { ToolCapabilityProfile } from '../../../../shared/classification';

/**
 * Bump whenever the profiling prompt or the mapping below changes. Stored
 * profiles from another revision are ignored and profiled again.
 */
export const TOOL_PROFILE_REVISION = 'tool-capabilities-v2';

/** Work methods a specialized tool can be built for. */
const METHOD_PURPOSES = [
  'study_notes_or_retrieval',
  'calculation_or_visualization',
  'read_reference',
  'coding_or_analysis',
  'drafting_or_problem_solving',
] as const;

/**
 * The single primary purpose the model names for a tool. Non-work purposes come
 * first so they are not the least likely choices of a small model.
 */
export const TOOL_PURPOSES = [
  'media_or_entertainment',
  'communication',
  'general_purpose',
  'system_utility',
  ...METHOD_PURPOSES,
  'unknown',
] as const;
export type ToolPurpose = (typeof TOOL_PURPOSES)[number];

/**
 * A specialized role lets a tool support a task without visible evidence, so it
 * is derived, not asked for. The model names one primary purpose, a question a
 * small local model answers reliably; only a tool built for a single work
 * method becomes specialized, with exactly that method. The earlier prompt
 * asked for a role plus a list of methods and showed the full list as the
 * answer shape: the model copied it, so nearly every tool, music players
 * included, became a specialized study tool.
 */
export function profileFromPurpose(purpose: ToolPurpose): ToolCapabilityProfile {
  const method = (METHOD_PURPOSES as readonly string[]).includes(purpose) ? purpose : null;
  return {
    role: method ? 'specialized' : purpose === 'unknown' ? 'unknown' : 'general_purpose',
    supportingModes: method ? [method] : [],
    revision: TOOL_PROFILE_REVISION,
  };
}
