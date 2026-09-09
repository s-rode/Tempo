import { CalendarDays, Compass, Pencil } from 'lucide-react'
import { ReactElement, useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../utils/trpc'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'

interface PlanningSettingsProps {
  openRequest?: number
}

const weekRange = (weekStartKey?: string): string => {
  if (!weekStartKey) return 'This week'
  const start = new Date(`${weekStartKey}T12:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })}–${end.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
}

export function PlanningSettings({ openRequest = 0 }: PlanningSettingsProps): ReactElement {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const { data: planning } = trpc.goals.getPlanning.useQuery(
    { token: token || '' },
    { enabled: !!token }
  )
  const [editing, setEditing] = useState<'weekly' | 'direction' | null>(null)
  const [value, setValue] = useState('')
  const invalidate = () => {
    void utils.goals.getPlanning.invalidate()
    void utils.goals.getActiveContext.invalidate()
  }
  const refreshIfChanged = (result: { effectiveContextChanged: boolean }) => {
    invalidate()
    if (result.effectiveContextChanged) void window.api?.refreshCurrentActivity()
  }
  const weekly = trpc.goals.setWeeklyFocus.useMutation({ onSuccess: refreshIfChanged })
  const direction = trpc.goals.setLongTermDirection.useMutation({ onSuccess: refreshIfChanged })
  const begin = (scope: 'weekly' | 'direction') => {
    setEditing(scope)
    setValue(scope === 'weekly' ? planning?.weeklyFocus || '' : planning?.longTermDirection || '')
  }
  const save = () => {
    if (!editing) return
    const mutation = editing === 'weekly' ? weekly : direction
    mutation.mutate(
      { token: token || '', text: value },
      {
        onSuccess: (result) => {
          refreshIfChanged(result)
          setEditing(null)
        }
      }
    )
  }
  useEffect(() => {
    if (openRequest && planning) begin('weekly')
  }, [openRequest, planning])
  const row = (
    scope: 'weekly' | 'direction',
    title: string,
    description: string,
    icon: ReactElement,
    text: string
  ) => (
    <section className="tempo-planning-row" aria-labelledby={`${scope}-focus-heading`}>
      <div className="tempo-planning-row-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id={`${scope}-focus-heading`}>{title}</h3>
          {scope === 'weekly' && <span>{weekRange(planning?.weekStartKey)}</span>}
        </div>
        <p>{description}</p>
        {editing === scope ? (
          <Textarea
            autoFocus
            rows={3}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditing(null)
              if (event.key === 'Enter' && event.metaKey) save()
            }}
          />
        ) : (
          <p className="tempo-planning-value">{text || 'Not set'}</p>
        )}
      </div>
      {editing === scope ? (
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          <Button size="sm" disabled={weekly.isLoading || direction.isLoading} onClick={save}>
            Save
          </Button>
        </div>
      ) : (
        <Button variant="ghost" size="xs" onClick={() => begin(scope)} aria-label={`Edit ${title}`}>
          <Pencil size={15} />
        </Button>
      )}
    </section>
  )
  return (
    <div className="tempo-planning-settings">
      {row(
        'weekly',
        'This week’s focus',
        'Used only when Today has no remaining tasks.',
        <CalendarDays size={16} />,
        planning?.weeklyFocus || ''
      )}
      {row(
        'direction',
        'Longer-term direction',
        'For reflection only. Tempo never uses it to classify activity.',
        <Compass size={16} />,
        planning?.longTermDirection || ''
      )}
    </div>
  )
}
