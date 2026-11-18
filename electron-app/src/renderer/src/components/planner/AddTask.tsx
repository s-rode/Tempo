import { Plus } from 'lucide-react'
import { forwardRef, ReactElement, useState } from 'react'
import { parseQuickTask, type PlannerGoal } from '../../lib/plannerModel'
import { displayMinutes } from '../../lib/taskEstimate'
import { GoalChip } from './GoalBits'
import type { Planner } from './usePlanner'

/**
 * Inline entry at the end of a day. "#goal" and a duration such as "45m" are
 * recognized while typing and previewed before the task is added.
 */
export const AddTask = forwardRef<
  HTMLInputElement,
  {
    dateKey: string
    goals: PlannerGoal[]
    planner: Planner
    defaultGoalId?: string | null
    placeholder?: string
    label: string
  }
>(function AddTask(
  { dateKey, goals, planner, defaultGoalId = null, placeholder = 'New task', label },
  ref
): ReactElement {
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const parsed = parseQuickTask(draft, goals)
  const goalId = parsed.goalId || defaultGoalId
  const goal = goals.find((entry) => entry.id === goalId) || null
  const submit = async () => {
    if (!parsed.text || pending) return
    const text = draft
    setPending(true)
    setDraft('')
    try {
      await planner.addTask(dateKey, { ...parsed, goalId })
    } catch {
      setDraft(text)
    } finally {
      setPending(false)
    }
  }
  return (
    <form
      className="planner-add"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <Plus size={13} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <input
          ref={ref}
          value={draft}
          placeholder={placeholder}
          aria-label={label}
          maxLength={560}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setDraft('')
              event.currentTarget.blur()
            }
          }}
        />
        {draft.trim() && (goal || parsed.estimatedMinutes) && (
          <div className="planner-add-preview" aria-live="polite">
            {goal && <GoalChip goal={goal} />}
            {parsed.estimatedMinutes ? (
              <span className="planner-task-estimate">
                {displayMinutes(parsed.estimatedMinutes)}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </form>
  )
})
