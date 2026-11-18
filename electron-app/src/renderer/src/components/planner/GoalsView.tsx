import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Target,
  Trash2
} from 'lucide-react'
import { ReactElement } from 'react'
import { goalColorVar, type PlannerGoal } from '../../lib/plannerModel'
import { Button } from '../ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu'
import { AnchoredMenu, useMenuAnchor } from './AnchoredMenu'
import { GoalMark } from './GoalBits'

export interface GoalActions {
  onNew: () => void
  onEdit: (goal: PlannerGoal) => void
  onSetAchieved: (goal: PlannerGoal, achieved: boolean) => void
  onMove: (goal: PlannerGoal, direction: -1 | 1) => void
  onDelete: (goal: PlannerGoal) => void
  onShowTasks: (goal: PlannerGoal) => void
}

function GoalCard({
  goal,
  first,
  last,
  actions
}: {
  goal: PlannerGoal
  first: boolean
  last: boolean
  actions: GoalActions
}): ReactElement {
  const menu = useMenuAnchor()
  const achieved = goal.completedAtMs !== null
  return (
    <article
      className="planner-goal-card"
      data-achieved={achieved || undefined}
      style={{ ['--goal' as string]: goalColorVar(goal.color) }}
      tabIndex={0}
      aria-label={`Goal: ${goal.title}`}
      onDoubleClick={() => actions.onEdit(goal)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === 'Enter') actions.onEdit(goal)
      }}
      onContextMenu={menu.openAtPointer}
    >
      <header>
        <span
          className="planner-goal-mark has-icon"
          style={{ width: 32, height: 32, fontSize: 17, color: goalColorVar(goal.color) }}
          aria-hidden="true"
        >
          <span>{goal.icon || <Target size={15} strokeWidth={2.2} />}</span>
        </span>
        <div className="min-w-0 flex-1">
          <h3>{goal.title}</h3>
          {achieved && (
            <p className="planner-goal-achieved">
              <CheckCircle2 size={12} aria-hidden="true" />
              Achieved{' '}
              {new Date(goal.completedAtMs!).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
              })}
            </p>
          )}
        </div>
        <button
          type="button"
          className="planner-icon-button"
          data-state={menu.anchor ? 'open' : undefined}
          aria-label={`Actions for ${goal.title}`}
          aria-haspopup="menu"
          aria-expanded={Boolean(menu.anchor)}
          onClick={menu.openBelow}
        >
          <MoreHorizontal size={15} />
        </button>
        <AnchoredMenu anchor={menu.anchor} onClose={menu.close} className="min-w-[190px]">
          <DropdownMenuItem onSelect={() => actions.onEdit(goal)}>
            <Pencil size={14} />
            Edit…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.onSetAchieved(goal, !achieved)}>
            {achieved ? <RotateCcw size={14} /> : <CheckCircle2 size={14} />}
            {achieved ? 'Reopen Goal' : 'Mark as Achieved'}
          </DropdownMenuItem>
          {!achieved && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={first} onSelect={() => actions.onMove(goal, -1)}>
                <ArrowUp size={14} />
                Move Up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={last} onSelect={() => actions.onMove(goal, 1)}>
                <ArrowDown size={14} />
                Move Down
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => actions.onDelete(goal)}
          >
            <Trash2 size={14} />
            Delete Goal…
          </DropdownMenuItem>
        </AnchoredMenu>
      </header>
      {goal.notes && <p className="planner-goal-notes">{goal.notes}</p>}
      <footer>
        <div className="planner-goal-counts">
          <span>
            <strong>{goal.doneTasks}</strong> {goal.doneTasks === 1 ? 'task' : 'tasks'} done
          </span>
          <span>
            <strong>{goal.openTasks}</strong> planned
          </span>
          {!achieved && (
            <button type="button" onClick={() => actions.onShowTasks(goal)}>
              Show in Week
            </button>
          )}
        </div>
      </footer>
    </article>
  )
}

/** Long-term goals: what the planned tasks are in service of. */
export function GoalsView({
  goals,
  actions
}: {
  goals: PlannerGoal[]
  actions: GoalActions
}): ReactElement {
  const active = goals.filter((goal) => goal.completedAtMs === null)
  const achieved = goals.filter((goal) => goal.completedAtMs !== null)
  if (!goals.length)
    return (
      <div className="planner-empty">
        <span className="planner-empty-icon">
          <Target size={22} strokeWidth={1.8} />
        </span>
        <h2>Name what you are working toward</h2>
        <p>
          A goal is something that takes months, not an afternoon. Link tasks to it in the week plan
          and every finished task becomes a visible step.
        </p>
        <Button size="sm" onClick={actions.onNew}>
          <Plus size={15} />
          New Goal
        </Button>
      </div>
    )
  return (
    <div className="planner-goals">
      <div className="planner-goal-grid">
        {active.map((goal, index) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            first={index === 0}
            last={index === active.length - 1}
            actions={actions}
          />
        ))}
        <button type="button" className="planner-goal-new" onClick={actions.onNew}>
          <Plus size={16} />
          New Goal
        </button>
      </div>
      {achieved.length > 0 && (
        <>
          <h2 className="planner-section-title">Achieved</h2>
          <div className="planner-goal-grid">
            {achieved.map((goal) => (
              <GoalCard key={goal.id} goal={goal} first last actions={actions} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export { GoalMark }
