import { useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { trpc } from '../utils/trpc'

type TransitionNotice = {
  id: string
  kind: 'focus_complete' | 'break_started' | 'break_complete' | 'pomodoro_complete' | 'task_target_reached'
  goal: string | null
  phaseIndex: number
  breakDurationMs: number | null
}

const minutes = (milliseconds: number | null) =>
  Math.max(1, Math.round((milliseconds || 0) / 60_000))

const notificationCopy = (notice: TransitionNotice) => {
  switch (notice.kind) {
    case 'task_target_reached':
      return {
        title: 'Planned work time reached',
        body: notice.goal ? `Are you finished with “${notice.goal}”? Finish or add more time in Tempo.` : 'Are you finished? Finish or add more time in Tempo.',
        action: 'open_tempo' as const,
        actionLabel: 'Finish or extend'
      }
    case 'focus_complete':
      return {
        title: 'Focus session complete',
        body: notice.goal ? `Completed: ${notice.goal}` : 'Your focus session is complete.',
        action: 'open_tempo' as const,
        actionLabel: 'Open Tempo'
      }
    case 'break_started':
      return {
        title: 'Work block complete',
        body: `Take your ${minutes(notice.breakDurationMs)}-minute break before the next block.`,
        action: 'open_tempo' as const,
        actionLabel: 'Open Tempo'
      }
    case 'break_complete':
      return notice.goal ? {
        title: 'Break complete',
        body: `Back to “${notice.goal}”. Your next work block has started.`,
        action: 'open_tempo' as const,
        actionLabel: 'Open Tempo'
      } : {
        title: 'Break complete',
        body: 'Choose one clear goal for your next Pomodoro block.',
        action: 'set_next_goal' as const,
        actionLabel: 'Set next goal'
      }
    case 'pomodoro_complete':
      return {
        title: 'Pomodoro complete',
        body: 'All four work blocks and the long break are complete.',
        action: 'open_tempo' as const,
        actionLabel: 'Open Tempo'
      }
  }
}

/** Delivers a stored transition once; the server remains the source of truth. */
export function useFocusTransitionAlerts(
  notice: TransitionNotice | null | undefined,
  alertsEnabled: boolean | undefined,
  chimeEnabled: boolean | undefined
) {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const acknowledgedIds = useRef(new Set<string>())
  const acknowledge = trpc.focusRuntime.acknowledgeTransitionNotice.useMutation({
    onSuccess: () => void utils.focusRuntime.getState.invalidate()
  })

  useEffect(() => {
    if (!notice || !token || acknowledgedIds.current.has(notice.id)) return
    acknowledgedIds.current.add(notice.id)
    if (alertsEnabled !== false) {
      const copy = notificationCopy(notice)
      window.api.showNotification({
        kind: 'session_transition',
        id: notice.id,
        title: copy.title,
        body: copy.body,
        action: copy.action,
        actionLabel: copy.actionLabel,
        playFallbackChime: chimeEnabled !== false
      })
    }
    acknowledge.mutate({ token, noticeId: notice.id })
  }, [notice, token, alertsEnabled, chimeEnabled, acknowledge])
}
