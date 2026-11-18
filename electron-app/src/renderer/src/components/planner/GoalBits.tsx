import { Check, Target } from 'lucide-react'
import { ReactElement, useEffect, useState } from 'react'
import {
  GOAL_COLORS,
  goalColorVar,
  type GoalColorId,
  type PlannerGoal
} from '../../lib/plannerModel'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'

/** The round colour mark of a goal, optionally carrying its emoji. */
export function GoalMark({
  goal,
  size = 10
}: {
  goal: Pick<PlannerGoal, 'color' | 'icon'> | null | undefined
  size?: number
}): ReactElement {
  if (goal?.icon && size >= 18)
    return (
      <span
        className="planner-goal-mark has-icon"
        style={{
          width: size,
          height: size,
          fontSize: size * 0.56,
          color: goalColorVar(goal.color)
        }}
        aria-hidden="true"
      >
        <span>{goal.icon}</span>
      </span>
    )
  return (
    <span
      className={cn('planner-goal-mark', !goal && 'is-empty')}
      style={{ width: size, height: size, color: goalColorVar(goal?.color) }}
      aria-hidden="true"
    />
  )
}

export function GoalChip({
  goal,
  className
}: {
  goal: Pick<PlannerGoal, 'color' | 'icon' | 'title'>
  className?: string
}): ReactElement {
  return (
    <span
      className={cn('planner-goal-chip', className)}
      style={{ color: goalColorVar(goal.color) }}
    >
      <GoalMark goal={goal} size={7} />
      <span>{goal.title}</span>
    </span>
  )
}

export interface GoalDraft {
  title: string
  notes: string
  color: GoalColorId
  icon: string
}

/** A sheet-style editor used for both a new goal and an existing one. */
export function GoalEditor({
  open,
  goal,
  suggestedColor,
  saving,
  onOpenChange,
  onSave
}: {
  open: boolean
  goal: PlannerGoal | null
  suggestedColor: GoalColorId
  saving: boolean
  onOpenChange: (open: boolean) => void
  onSave: (draft: GoalDraft) => void
}): ReactElement {
  const [draft, setDraft] = useState<GoalDraft>({
    title: '',
    notes: '',
    color: suggestedColor,
    icon: ''
  })
  useEffect(() => {
    if (!open) return
    setDraft(
      goal
        ? {
            title: goal.title,
            notes: goal.notes,
            color: (GOAL_COLORS.find((entry) => entry.id === goal.color)?.id ||
              'graphite') as GoalColorId,
            icon: goal.icon
          }
        : { title: '', notes: '', color: suggestedColor, icon: '' }
    )
  }, [open, goal, suggestedColor])
  const canSave = draft.title.trim().length > 0 && !saving
  const save = () => {
    if (canSave) onSave({ ...draft, title: draft.title.trim(), notes: draft.notes.trim() })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="planner-goal-editor sm:max-w-[440px]"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.metaKey) save()
        }}
      >
        <DialogHeader>
          <DialogTitle>{goal ? 'Edit Goal' : 'New Goal'}</DialogTitle>
        </DialogHeader>
        <div className="planner-goal-editor-title">
          <span
            className="planner-goal-mark has-icon"
            style={{ width: 36, height: 36, fontSize: 19, color: goalColorVar(draft.color) }}
          >
            <span>{draft.icon || <Target size={17} strokeWidth={2.2} />}</span>
          </span>
          <Input
            autoFocus
            value={draft.title}
            maxLength={120}
            placeholder="What do you want to achieve?"
            aria-label="Goal title"
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.metaKey) save()
            }}
          />
        </div>
        <label className="planner-field">
          <span>Why it matters</span>
          <Textarea
            rows={3}
            value={draft.notes}
            maxLength={2000}
            placeholder="Optional. A sentence your future self will recognise."
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
        </label>
        <div className="planner-field">
          <span id="planner-goal-colour">Colour</span>
          <div className="planner-swatches" role="radiogroup" aria-labelledby="planner-goal-colour">
            {GOAL_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                role="radio"
                aria-checked={draft.color === color.id}
                aria-label={color.label}
                title={color.label}
                className="planner-swatch"
                style={{ color: goalColorVar(color.id) }}
                onClick={() => setDraft({ ...draft, color: color.id })}
              >
                {draft.color === color.id && <Check size={11} strokeWidth={3.2} />}
              </button>
            ))}
          </div>
        </div>
        <label className="planner-field planner-field-inline">
          <span>Symbol</span>
          <Input
            value={draft.icon}
            maxLength={8}
            placeholder="Emoji, optional"
            className="w-36"
            aria-label="Goal symbol, one emoji"
            onChange={(event) =>
              setDraft({ ...draft, icon: [...event.target.value.trim()].slice(0, 2).join('') })
            }
          />
        </label>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSave} onClick={save}>
            {goal ? 'Save' : 'Add Goal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
