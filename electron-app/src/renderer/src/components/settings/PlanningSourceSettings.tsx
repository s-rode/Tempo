import { ListChecks } from 'lucide-react'
import { ReactElement } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../hooks/use-toast'
import { scheduleGoalProfileRefresh } from '../../lib/goalProfileRefresh'
import { trpc } from '../../utils/trpc'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import '../../styles/planner.css'

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
    <section
      className="tempo-planning-row planner-source"
      aria-labelledby="planning-source-heading"
    >
      <div className="tempo-planning-row-icon" aria-hidden="true">
        <ListChecks size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 id="planning-source-heading">Tasks come from</h3>
        <p>
          {source === 'planner'
            ? 'Tempo’s planner: long-term goals, a plan for each day of the week, and a queue that shows one task at a time. Find it under Plan in the sidebar.'
            : 'Apple Reminders. Tempo reads the reminders you choose below and never changes them.'}
        </p>
        {source === 'planner' && data?.remindersConnected && (
          <p className="tempo-planning-secondary">
            Reminders stays connected but is not used while the planner is on.
          </p>
        )}
      </div>
      <ToggleGroup
        type="single"
        size="sm"
        className="tempo-glass-segmented shrink-0"
        value={source}
        disabled={!data || setSource.isLoading}
        aria-label="Task source"
        onValueChange={(value) => {
          if (value && value !== source)
            setSource.mutate({ ...auth, source: value as 'reminders' | 'planner' })
        }}
      >
        <ToggleGroupItem value="reminders" className="px-3 text-xs">
          Apple Reminders
        </ToggleGroupItem>
        <ToggleGroupItem value="planner" className="px-3 text-xs">
          Tempo Planner
        </ToggleGroupItem>
      </ToggleGroup>
    </section>
  )
}
