import { AlertCircle } from 'lucide-react'
import { ReactElement, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../utils/trpc'
import { scheduleGoalProfileRefresh } from '../../lib/goalProfileRefresh'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { SettingsRow, SettingsSection } from './SettingsLayout'

interface PlanningSettingsProps {
  openRequest?: number
  onOpenRequestHandled?: (request: number) => void
}

const weekRange = (weekStartKey?: string): string => {
  if (!weekStartKey) return 'This week'
  const start = new Date(`${weekStartKey}T12:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })}–${end.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
}

export function PlanningSettings({
  openRequest = 0,
  onOpenRequestHandled
}: PlanningSettingsProps): ReactElement {
  const handledRequest = useRef(0)
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
    // Open the editor once per request, not again whenever planning refetches.
    if (!openRequest || !planning || handledRequest.current === openRequest) return
    handledRequest.current = openRequest
    onOpenRequestHandled?.(openRequest)
    begin('weekly')
  }, [openRequest, planning])
  const saveShortcut = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') setEditing(null)
    if (event.key === 'Enter' && event.metaKey) save()
  }
  const isSaving = weekly.isLoading || direction.isLoading

  const editActions = (
    <>
      <Button variant="glass" size="compact" onClick={() => setEditing(null)}>
        Cancel
      </Button>
      <Button size="compact" disabled={isSaving} onClick={save}>
        Save
      </Button>
    </>
  )

  return (
    <SettingsSection title="Goals">
      <SettingsRow
        title={
          <span className="flex items-baseline gap-2">
            This week’s focus
            <span className="tempo-pref-meta">{weekRange(planning?.weekStartKey)}</span>
          </span>
        }
        description="A concise, positive objective. Used for classification only after Today’s Plan is complete."
        control={
          editing === 'weekly' ? (
            editActions
          ) : (
            <Button
              variant="glass"
              size="compact"
              onClick={() => begin('weekly')}
              aria-label="Edit this week’s focus"
            >
              Edit
            </Button>
          )
        }
      >
        {editing === 'weekly' ? (
          <div className="tempo-pref-form-grid">
            <label htmlFor="weekly-focus">Focus</label>
            <Textarea
              id="weekly-focus"
              autoFocus
              rows={2}
              className="tempo-pref-input"
              value={weeklyFocus}
              onChange={(event) => setWeeklyFocus(event.target.value)}
              onKeyDown={saveShortcut}
            />
            <label htmlFor="attention-guardrail">Guardrail</label>
            <div>
              <Textarea
                id="attention-guardrail"
                rows={2}
                className="tempo-pref-input"
                placeholder="Optional"
                value={attentionGuardrail}
                onChange={(event) => setAttentionGuardrail(event.target.value)}
                onKeyDown={saveShortcut}
              />
              <p className="tempo-pref-description mt-1.5">
                Only tips genuinely ambiguous activity toward distraction. It never makes work
                productive.
              </p>
            </div>
          </div>
        ) : (
          <div className="tempo-pref-value">
            <p data-empty={!planning?.weeklyFocus || undefined}>
              {planning?.weeklyFocus || 'Not set'}
            </p>
            {planning?.attentionGuardrail && (
              <p className="tempo-pref-description">Guardrail: {planning.attentionGuardrail}</p>
            )}
            {planning?.needsWeeklyFocusReview && (
              <p className="tempo-pref-description flex items-center gap-1.5">
                <AlertCircle size={13} aria-hidden="true" /> Review the imported focus to separate
                your objective and guardrail.
              </p>
            )}
          </div>
        )}
      </SettingsRow>
      <SettingsRow
        title="Longer-term direction"
        description="For reflection only. Tempo never uses it to classify activity."
        control={
          editing === 'direction' ? (
            editActions
          ) : (
            <Button
              variant="glass"
              size="compact"
              onClick={() => begin('direction')}
              aria-label="Edit longer-term direction"
            >
              Edit
            </Button>
          )
        }
      >
        {editing === 'direction' ? (
          <Textarea
            autoFocus
            rows={3}
            aria-label="Longer-term direction"
            className="tempo-pref-input"
            value={directionValue}
            onChange={(event) => setDirectionValue(event.target.value)}
            onKeyDown={saveShortcut}
          />
        ) : (
          <div className="tempo-pref-value">
            <p data-empty={!planning?.longTermDirection || undefined}>
              {planning?.longTermDirection || 'Not set'}
            </p>
          </div>
        )}
      </SettingsRow>
    </SettingsSection>
  )
}
