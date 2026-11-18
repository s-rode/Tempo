import { ReactElement } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../hooks/use-toast'
import { scheduleGoalProfileRefresh } from '../../lib/goalProfileRefresh'
import { trpc } from '../../utils/trpc'
import { SettingsRow, SettingsSection, SettingsSegmented } from './SettingsLayout'

/** Chooses where Today's tasks come from: Apple Reminders or Tempo's own planner. */
export function PlanningSourceSettings(): ReactElement {
  const { token } = useAuth()
  const auth = { token: token || '' }
  const utils = trpc.useContext()
  const { data } = trpc.planner.getSource.useQuery(auth, { enabled: !!token })
  const setSource = trpc.planner.setSource.useMutation({
    onSuccess: (result) => {
      void utils.planner.invalidate()
      void utils.goals.invalidate()
      if (result.effectiveContextChanged) void window.api?.refreshCurrentActivity()
      scheduleGoalProfileRefresh(result, () => utils.goals.getActiveContext.fetch(auth))
    },
    onError: (error) =>
      toast({
        title: 'Could not change the task source',
        description: error.message,
        variant: 'destructive'
      })
  })
  const source =
    setSource.variables?.source && setSource.isLoading
      ? setSource.variables.source
      : data?.source || 'reminders'
  return (
    <SettingsSection title="Tasks">
      <SettingsRow
        title="Tasks come from"
        description={
          source === 'planner'
            ? 'Tempo’s planner: long-term goals, a plan for each day of the week, and a queue that shows one task at a time. Find it under Plan in the sidebar.'
            : 'Apple Reminders. Tempo reads the reminders you choose below and never changes them.'
        }
        control={
          <SettingsSegmented
            value={source}
            disabled={!data || setSource.isLoading}
            aria-label="Task source"
            options={[
              { value: 'reminders', label: 'Apple Reminders' },
              { value: 'planner', label: 'Tempo Planner' }
            ]}
            onChange={(value) => setSource.mutate({ ...auth, source: value })}
          />
        }
      >
        {source === 'planner' && data?.remindersConnected && (
          <p className="tempo-pref-description">
            Reminders stays connected but is not used while the planner is on.
          </p>
        )}
      </SettingsRow>
    </SettingsSection>
  )
}
