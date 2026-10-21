import { useEffect } from 'react'
import type { ActiveWindowEvent, ActiveWindowDetails } from 'shared'

export function useRelevanceCheck(
  event: ActiveWindowEvent | null | undefined,
  trackingActive: boolean,
  activeWindow?: ActiveWindowDetails | null,
  activeGoal?: string | null
) {
  useEffect(() => {
    const target =
      event?.goalSnapshot?.targets.find((t) => t.ref === event.matchedGoalRef) ||
      (event?.goalSnapshot?.targets.length === 1 ? event.goalSnapshot.targets[0] : null)
    const eligible =
      trackingActive &&
      (!activeWindow || activeWindow.ownerName === event?.ownerName) &&
      (!activeGoal || target?.text === activeGoal) &&
      event?.eventId &&
      event.learningToolKey &&
      target &&
      event.classificationStatus === 'insufficient_context' &&
      ['insufficient_evidence', 'policy_rejected'].includes(event.classificationBasis || '') &&
      !event.classificationFailureCode
    window.api.updateRelevanceEpisode(
      eligible
        ? {
            key: `${event.userId}:${event.learningToolKey}:${target.taskKey}`,
            eventId: event.eventId!,
            application: event.ownerName
          }
        : null
    )
    // Cleanup on unmount, not on repeated captures: the main process owns the timer.
  }, [event, trackingActive, activeWindow?.ownerName, activeGoal])
  useEffect(() => () => window.api.updateRelevanceEpisode(null), [])
}
