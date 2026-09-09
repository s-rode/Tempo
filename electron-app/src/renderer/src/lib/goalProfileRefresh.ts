type ActiveGoalContext = {
  classificationContextFingerprint: string
  profilePending: boolean
}

/**
 * A bounded follow-up after changing a goal. It is deliberately not polling:
 * at most two reads are made, and a new capture happens only after a local
 * goal-support profile actually changes the classification context.
 */
export const scheduleGoalProfileRefresh = (
  initial: Pick<ActiveGoalContext, 'classificationContextFingerprint' | 'profilePending'>,
  getContext: () => Promise<ActiveGoalContext>
): void => {
  if (!initial.profilePending) return
  let refreshed = false
  for (const delayMs of [3000, 9000]) {
    window.setTimeout(() => {
      void getContext()
        .then((context) => {
          if (
            !refreshed &&
            !context.profilePending &&
            context.classificationContextFingerprint !== initial.classificationContextFingerprint
          ) {
            refreshed = true
            void window.api?.refreshCurrentActivity()
          }
        })
        .catch(() => {
          // The next normal activity capture will use a ready profile. There
          // is no retry loop or monitoring-side polling for this UI backup.
        })
    }, delayMs)
  }
}
