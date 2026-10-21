import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { trpc } from '../utils/trpc'
import { scheduleGoalProfileRefresh } from '../lib/goalProfileRefresh'

export function useRemindersAvailable(): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let mounted = true
    void window.api?.getEnvVariables().then((env) => {
      if (mounted) setAvailable(Boolean(env.REMINDERS_AVAILABLE))
    })
    return () => {
      mounted = false
    }
  }, [])
  return available
}

export function useRefreshReminderViews() {
  const { token } = useAuth()
  const utils = trpc.useContext()
  return () => {
    void utils.reminders.getStatus.invalidate()
    void utils.goals.getDailyPlan.invalidate()
    void utils.goals.getActiveContext.invalidate()
    void utils.focusRuntime.getState.invalidate()
    if (token)
      void utils.goals.getActiveContext.fetch({ token }).then((context) => {
        void window.api?.refreshCurrentActivity()
        scheduleGoalProfileRefresh(context, () => utils.goals.getActiveContext.fetch({ token }))
      })
  }
}

/** One app-level subscription; synchronization itself lives in Electron main. */
export function useReminderUpdates(): void {
  const { token } = useAuth()
  const refresh = useRefreshReminderViews()
  useEffect(() => window.api?.onRemindersChanged(refresh), [token])
}
