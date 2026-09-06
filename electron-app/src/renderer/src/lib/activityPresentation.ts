/**
 * The category is the authoritative statement about an activity. Model-written
 * display metadata is useful for productive work, but it must never make an
 * activity classified as distracting appear to be goal-related work.
 */
export interface ActivityPresentationInput {
  isProductive?: boolean | null
  ownerName?: string | null
  title?: string | null
  activityLabel?: string | null
  activitySummary?: string | null
  categoryReasoning?: string | null
}

const sourceName = (activity: ActivityPresentationInput): string =>
  activity.ownerName?.trim() || activity.title?.trim() || 'this activity'

export const distractionLabel = (activity: ActivityPresentationInput): string =>
  `Distracted by ${sourceName(activity)}`

export const displayActivityLabel = (activity: ActivityPresentationInput): string => {
  if (activity.isProductive === false) return distractionLabel(activity)
  return activity.activityLabel?.trim() || activity.title?.trim() || sourceName(activity)
}

export const displayActivitySummary = (activity: ActivityPresentationInput): string | undefined => {
  if (activity.isProductive === false) {
    // Historical enrichment and manual rules may carry old model prose. Only
    // render the explicit off-goal format written by the current pipeline.
    // This keeps a legacy “Study Focus” label from resurfacing below a
    // distraction title.
    if (activity.activitySummary?.trim().startsWith('Off goal:')) {
      return activity.activitySummary.trim()
    }
    return 'Does not support the current goal.'
  }
  return activity.activitySummary?.trim() || undefined
}
