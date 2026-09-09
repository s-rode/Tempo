import { AlertCircle, CalendarDays, Compass, Pencil, ShieldCheck } from 'lucide-react'
import { ReactElement, useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../utils/trpc'
import { scheduleGoalProfileRefresh } from '../../lib/goalProfileRefresh'
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
  const [weeklyFocus, setWeeklyFocus] = useState('')
  const [attentionGuardrail, setAttentionGuardrail] = useState('')
  const [directionValue, setDirectionValue] = useState('')
  const invalidate = () => {
    void utils.goals.getPlanning.invalidate()
    void utils.goals.getActiveContext.invalidate()
  }
  const refreshIfChanged = (result: {
    effectiveContextChanged: boolean
    classificationContextFingerprint: string
    profilePending: boolean
  }) => {
    invalidate()
    if (result.effectiveContextChanged) void window.api?.refreshCurrentActivity()
    scheduleGoalProfileRefresh(result, () =>
      utils.goals.getActiveContext.fetch({ token: token || '' })
    )
  }
  const weekly = trpc.goals.setWeeklyFocus.useMutation({ onSuccess: refreshIfChanged })
  const direction = trpc.goals.setLongTermDirection.useMutation({ onSuccess: refreshIfChanged })
  const begin = (scope: 'weekly' | 'direction') => {
    setEditing(scope)
    if (scope === 'weekly') {
      setWeeklyFocus(planning?.weeklyFocus || '')
      setAttentionGuardrail(planning?.attentionGuardrail || '')
    } else {
      setDirectionValue(planning?.longTermDirection || '')
    }
  }
  const save = () => {
    if (!editing) return
    if (editing === 'weekly') {
      weekly.mutate(
        { token: token || '', focusText: weeklyFocus, attentionGuardrail },
        {
          onSuccess: (result) => {
            refreshIfChanged(result)
            setEditing(null)
          }
        }
      )
      return
    }
    direction.mutate(
      { token: token || '', text: directionValue },
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
  const saveShortcut = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') setEditing(null)
    if (event.key === 'Enter' && event.metaKey) save()
  }
  const isSaving = weekly.isLoading || direction.isLoading

  return (
    <div className="tempo-planning-settings">
      <section className="tempo-planning-row" aria-labelledby="weekly-focus-heading">
        <div className="tempo-planning-row-icon" aria-hidden="true">
          <CalendarDays size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="weekly-focus-heading">This week’s focus</h3>
            <span>{weekRange(planning?.weekStartKey)}</span>
          </div>
          <p>A concise positive objective used only after Today’s Plan is complete.</p>
          {editing === 'weekly' ? (
            <div className="mt-2 space-y-3">
              <label className="tempo-planning-field">
                <span>Focus</span>
                <Textarea
                  autoFocus
                  rows={2}
                  value={weeklyFocus}
                  onChange={(event) => setWeeklyFocus(event.target.value)}
                  onKeyDown={saveShortcut}
                />
              </label>
              <label className="tempo-planning-field">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck size={14} /> Attention guardrail <em>Optional</em>
                </span>
                <Textarea
                  rows={2}
                  value={attentionGuardrail}
                  onChange={(event) => setAttentionGuardrail(event.target.value)}
                  onKeyDown={saveShortcut}
                />
                <small>
                  Only resolves genuinely ambiguous activity toward distraction. It never makes work
                  productive.
                </small>
              </label>
            </div>
          ) : (
            <>
              <p className="tempo-planning-value">{planning?.weeklyFocus || 'Not set'}</p>
              {planning?.attentionGuardrail && (
                <p className="tempo-planning-secondary">Guardrail: {planning.attentionGuardrail}</p>
              )}
              {planning?.needsWeeklyFocusReview && (
                <p className="tempo-planning-secondary flex items-center gap-1.5">
                  <AlertCircle size={14} /> Review imported focus to separate your objective and
                  guardrail.
                </p>
              )}
            </>
          )}
        </div>
        {editing === 'weekly' ? (
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={isSaving} onClick={save}>
              Save
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => begin('weekly')}
            aria-label="Edit this week’s focus"
          >
            <Pencil size={15} />
          </Button>
        )}
      </section>

      <section className="tempo-planning-row" aria-labelledby="direction-heading">
        <div className="tempo-planning-row-icon" aria-hidden="true">
          <Compass size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id="direction-heading">Longer-term direction</h3>
          <p>For reflection only. Tempo never uses it to classify activity.</p>
          {editing === 'direction' ? (
            <Textarea
              autoFocus
              rows={3}
              value={directionValue}
              onChange={(event) => setDirectionValue(event.target.value)}
              onKeyDown={saveShortcut}
            />
          ) : (
            <p className="tempo-planning-value">{planning?.longTermDirection || 'Not set'}</p>
          )}
        </div>
        {editing === 'direction' ? (
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={isSaving} onClick={save}>
              Save
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => begin('direction')}
            aria-label="Edit longer-term direction"
          >
            <Pencil size={15} />
          </Button>
        )}
      </section>
    </div>
  )
}
