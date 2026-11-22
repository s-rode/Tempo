import { Plus } from 'lucide-react'
import {
  forwardRef,
  KeyboardEvent,
  ReactElement,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import {
  goalForNewTask,
  parseQuickTask,
  type PlannerGoal,
  type PlannerTask
} from '../../lib/plannerModel'
import { displayMinutes } from '../../lib/taskEstimate'
import { cn } from '../../lib/utils'
import { GoalChip, GoalMark } from './GoalBits'
import type { Planner } from './usePlanner'

/**
 * Inline entry at the end of a day. "#goal" and a duration such as "45m" are
 * recognized while typing and previewed before the task is added. A task added
 * without a goal offers the open goals right below, so one click (or the arrow
 * keys and Return) links it without a trip through the context menu. A name
 * used before starts with the goal it was last linked to.
 */
export const AddTask = forwardRef<
  HTMLInputElement,
  {
    dateKey: string
    goals: PlannerGoal[]
    planner: Planner
    /** Tells entries apart that share a day, such as the queue and the week. */
    scope: string
    defaultGoalId?: string | null
    placeholder?: string
    label: string
  }
>(function AddTask(
  { dateKey, goals, planner, scope, defaultGoalId = null, placeholder = 'New task', label },
  ref
): ReactElement {
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement)
  const parsed = parseQuickTask(draft, goals)
  const suggestion = goalForNewTask(parsed, defaultGoalId, planner.rememberedGoals, goals)
  const goalId = suggestion.goalId
  const goal = goals.find((entry) => entry.id === goalId) || null
  const openGoals = goals.filter((entry) => entry.completedAtMs === null)
  const prompt =
    planner.goalPrompt?.dateKey === dateKey && planner.goalPrompt.scope === scope
      ? planner.goalPrompt
      : null
  const pickerRef = useRef<GoalPickerHandle>(null)

  // The empty queue becomes a list on its first task, which swaps this field
  // for a new one; carry the focus over so typing the next task just works.
  useEffect(() => {
    if (prompt && document.activeElement === document.body) inputRef.current?.focus()
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async () => {
    if (!parsed.text || pending) return
    const text = draft
    setPending(true)
    setDraft('')
    try {
      const { result: task } = await planner.addTask(dateKey, { ...parsed, goalId })
      if (!goalId && openGoals.length) planner.promptForGoal({ task, dateKey, scope })
      else planner.dismissGoalPrompt()
    } catch {
      setDraft(text)
    } finally {
      setPending(false)
    }
  }
  return (
    <div
      className="planner-add-wrap"
      onBlur={(event) => {
        // Leaving the entry (not moving between the field and a goal) puts the
        // question away.
        // Switching to another app keeps it.
        if (!document.hasFocus()) return
        if (prompt && !event.currentTarget.contains(event.relatedTarget as Node | null))
          pickerRef.current?.close()
      }}
    >
      <form
        className="planner-add"
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft.trim() && prompt) {
            pickerRef.current?.chooseHighlighted()
            return
          }
          void submit()
        }}
      >
        <Plus size={13} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <input
            ref={inputRef}
            value={draft}
            placeholder={placeholder}
            aria-label={label}
            maxLength={560}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                if (prompt) {
                  event.preventDefault()
                  pickerRef.current?.close()
                  return
                }
                setDraft('')
                event.currentTarget.blur()
                return
              }
              // With nothing typed, the arrow keys walk the goals below.
              if (prompt && !draft) pickerRef.current?.handleKey(event)
            }}
          />
          {draft.trim() && (goal || parsed.estimatedMinutes) && (
            <div className="planner-add-preview" aria-live="polite">
              {goal && (
                <span
                  className="planner-add-goal"
                  title={
                    suggestion.remembered
                      ? `Last time “${parsed.text}” was for ${goal.title}. Type #goal to pick another.`
                      : undefined
                  }
                >
                  <GoalChip goal={goal} />
                  {suggestion.remembered && <span className="planner-add-hint">as last time</span>}
                </span>
              )}
              {parsed.estimatedMinutes ? (
                <span className="planner-task-estimate">
                  {displayMinutes(parsed.estimatedMinutes)}
                </span>
              ) : null}
            </div>
          )}
        </div>
      </form>
      {prompt && (
        <GoalPicker
          key={prompt.task.id}
          ref={pickerRef}
          task={prompt.task}
          goals={openGoals}
          onChoose={(choice) => {
            if (choice) planner.updateTask(prompt.task, dateKey, { goalId: choice })
          }}
          onClosed={() => {
            if (planner.goalPrompt?.task.id === prompt.task.id) planner.dismissGoalPrompt()
          }}
          onReturnFocus={() => inputRef.current?.focus()}
        />
      )}
    </div>
  )
})

type GoalPickerHandle = {
  handleKey: (event: KeyboardEvent<HTMLElement>) => void
  chooseHighlighted: () => void
  close: () => void
}

/** The goals as a row of chips under the field, with "No goal" first. */
const GoalPicker = forwardRef<
  GoalPickerHandle,
  {
    task: PlannerTask
    goals: PlannerGoal[]
    onChoose: (goalId: string | null) => void
    onClosed: () => void
    onReturnFocus: () => void
  }
>(function GoalPicker({ task, goals, onChoose, onClosed, onReturnFocus }, ref): ReactElement {
  // -1: nothing highlighted, so Return in the empty field never picks by accident.
  const [highlight, setHighlight] = useState(-1)
  const [chosen, setChosen] = useState<string | null | undefined>(undefined)
  const [closing, setClosing] = useState(false)
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([])
  const options: (PlannerGoal | null)[] = [null, ...goals]

  const close = () => setClosing(true)
  const choose = (index: number) => {
    if (closing || index < 0 || index >= options.length) return
    const goalId = options[index]?.id ?? null
    setChosen(goalId)
    onChoose(goalId)
    close()
  }
  const move = (delta: number, from = highlight): number => {
    const next =
      from < 0
        ? delta > 0
          ? 0
          : options.length - 1
        : (from + delta + options.length) % options.length
    setHighlight(next)
    return next
  }
  const handleKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      move(1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(-1)
    }
  }
  useImperativeHandle(ref, () => ({
    handleKey,
    chooseHighlighted: () => (highlight >= 0 ? choose(highlight) : close()),
    close
  }))

  // Reduce Motion skips the closing animation, so finish at once.
  useEffect(() => {
    if (!closing) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) onClosed()
  }, [closing])

  return (
    <div
      className={cn('planner-goal-picker', closing && 'is-closing')}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) onClosed()
      }}
    >
      <div className="planner-goal-picker-inner">
        <p className="planner-goal-picker-label" id={`goal-picker-${task.id}`}>
          Goal for <span>{task.text}</span>
        </p>
        <div
          className="planner-goal-picker-options"
          role="radiogroup"
          aria-labelledby={`goal-picker-${task.id}`}
        >
          {options.map((option, index) => (
            <button
              key={option?.id || 'none'}
              ref={(node) => {
                buttonsRef.current[index] = node
              }}
              type="button"
              role="radio"
              aria-checked={chosen !== undefined && chosen === (option?.id ?? null)}
              tabIndex={index === Math.max(highlight, 0) ? 0 : -1}
              className={cn(
                'planner-goal-option',
                !option && 'is-none',
                index === highlight && 'is-highlighted'
              )}
              title={option ? option.title : 'Keep this task without a goal'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                choose(index)
                onReturnFocus()
              }}
              onFocus={() => setHighlight(index)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  close()
                  onReturnFocus()
                  return
                }
                if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return
                event.preventDefault()
                const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
                buttonsRef.current[move(delta, index)]?.focus()
              }}
            >
              <GoalMark goal={option} size={7} />
              <span>{option ? option.title : 'No goal'}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
})
