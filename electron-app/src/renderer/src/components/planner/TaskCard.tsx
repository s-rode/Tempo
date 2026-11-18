import {
  ArrowRight,
  Check,
  Clock,
  CornerDownRight,
  MoreHorizontal,
  Pencil,
  Play,
  Target,
  Trash2,
  Undo2
} from 'lucide-react'
import { KeyboardEvent, ReactElement, ReactNode, useEffect, useRef, useState } from 'react'
import {
  addDays,
  goalColorVar,
  relativeDayLabel,
  shortWeekday,
  weekStartOf,
  type PlannerGoal,
  type PlannerTask
} from '../../lib/plannerModel'
import { displayMinutes } from '../../lib/taskEstimate'
import { cn } from '../../lib/utils'
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '../ui/dropdown-menu'
import { AnchoredMenu, useMenuAnchor } from './AnchoredMenu'
import { GoalChip, GoalMark } from './GoalBits'
import type { Planner } from './usePlanner'

const ESTIMATES = [15, 25, 30, 45, 60, 90, 120, 180]

export interface TaskCardProps {
  task: PlannerTask
  dateKey: string
  todayKey: string
  goals: PlannerGoal[]
  planner: Planner
  /** Position among the open tasks of its day, for keyboard reordering. */
  index: number
  openCount: number
  variant?: 'card' | 'row'
  /** Leading element, such as the queue number. */
  lead?: ReactNode
  inFocus?: boolean
  dimmed?: boolean
  canStart?: boolean
  onStart?: () => void
  dragging?: boolean
  onDragStart?: () => void
  onDragEnd?: () => void
}

/**
 * One planned task. Everything on it is reachable three ways, as on the Mac:
 * directly (click, drag, double-click to rename), from the context menu, and
 * from the keyboard while the card has focus.
 */
export function TaskCard({
  task,
  dateKey,
  todayKey,
  goals,
  planner,
  index,
  openCount,
  variant = 'card',
  lead,
  inFocus = false,
  dimmed = false,
  canStart = false,
  onStart,
  dragging = false,
  onDragStart,
  onDragEnd
}: TaskCardProps): ReactElement {
  const menu = useMenuAnchor()
  const menuOpen = Boolean(menu.anchor)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(task.text)
  const cardRef = useRef<HTMLDivElement>(null)
  const done = task.completedAtMs !== null
  const goal = goals.find((entry) => entry.id === task.goalId) || null
  const isToday = dateKey === todayKey
  const isPast = dateKey < todayKey
  const activeGoals = goals.filter(
    (entry) => entry.completedAtMs === null || entry.id === task.goalId
  )
  useEffect(() => {
    if (!editing) setText(task.text)
  }, [task.text, editing])

  const rename = () => {
    setEditing(false)
    const next = text.trim()
    if (next && next !== task.text) planner.updateTask(task, dateKey, { text: next })
    else setText(task.text)
    cardRef.current?.focus()
  }
  const moveTo = (toDateKey: string, toIndex: number) =>
    planner.moveTask(task, dateKey, toDateKey, toIndex, { fromIndex: index })
  const nextMonday = addDays(weekStartOf(todayKey), 7)
  const destinations = [
    { key: todayKey, label: 'Today' },
    { key: addDays(todayKey, 1), label: 'Tomorrow' },
    { key: nextMonday, label: 'Next Week' }
  ].filter((entry) => entry.key !== dateKey)
  const weekDays = Array.from({ length: 7 }, (_, offset) =>
    addDays(weekStartOf(dateKey < todayKey ? todayKey : dateKey), offset)
  ).filter(
    (key) => key >= todayKey && key !== dateKey && !destinations.some((entry) => entry.key === key)
  )

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing || event.target !== event.currentTarget) return
    const handle = (action: () => void) => {
      event.preventDefault()
      action()
    }
    if (event.key === ' ') return handle(() => planner.setCompleted(task, dateKey, !done))
    if (event.key === 'Enter' && event.metaKey) {
      if (canStart && onStart) handle(onStart)
      return
    }
    if (event.key === 'Enter' || event.key === 'F2') return handle(() => setEditing(true))
    if (event.key === 'Backspace' || event.key === 'Delete')
      return handle(() => planner.deleteTask(task, dateKey))
    if (done) return
    if (event.altKey && event.key === 'ArrowUp' && index > 0)
      return handle(() => moveTo(dateKey, index - 1))
    if (event.altKey && event.key === 'ArrowDown' && index < openCount - 1)
      return handle(() => moveTo(dateKey, index + 1))
    if (event.altKey && event.key === 'ArrowRight')
      return handle(() => moveTo(addDays(dateKey < todayKey ? todayKey : dateKey, 1), 999))
    if (event.altKey && event.key === 'ArrowLeft' && addDays(dateKey, -1) >= todayKey)
      return handle(() => moveTo(addDays(dateKey, -1), 999))
  }

  return (
    <div
      ref={cardRef}
      role="listitem"
      tabIndex={0}
      data-task-id={task.id}
      className={cn(
        'planner-task',
        variant === 'row' && 'is-row',
        done && 'is-done',
        dimmed && 'is-dimmed',
        inFocus && 'is-in-focus',
        dragging && 'is-dragging',
        menuOpen && 'is-menu-open'
      )}
      style={{ ['--goal' as string]: goalColorVar(goal?.color) }}
      draggable={!done && !editing}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', task.text)
        onDragStart?.()
      }}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => {
        if (!editing) menu.openAtPointer(event)
      }}
      aria-label={`${task.text}${goal ? `, goal ${goal.title}` : ''}${done ? ', completed' : ''}`}
    >
      {lead}
      <button
        type="button"
        className="planner-check"
        aria-label={`Mark ${task.text} ${done ? 'not done' : 'done'}`}
        title={done ? 'Mark as not done' : 'Mark as done'}
        onClick={() => planner.setCompleted(task, dateKey, !done)}
      >
        <Check size={11} strokeWidth={3.2} aria-hidden="true" />
      </button>
      <div className="planner-task-body">
        {editing ? (
          <textarea
            autoFocus
            rows={1}
            className="planner-task-edit"
            value={text}
            maxLength={500}
            aria-label="Task title"
            onFocus={(event) => event.target.select()}
            onChange={(event) => setText(event.target.value.replace(/\n/g, ' '))}
            onBlur={rename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                rename()
              }
              if (event.key === 'Escape') {
                setText(task.text)
                setEditing(false)
                cardRef.current?.focus()
              }
            }}
          />
        ) : (
          <p className="planner-task-title" onDoubleClick={() => setEditing(true)}>
            {task.text}
          </p>
        )}
        {(goal || task.estimatedMinutes || task.carriedFromDateKey || inFocus) && (
          <div className="planner-task-meta">
            {inFocus && (
              <span className="planner-task-live">
                <i aria-hidden="true" />
                In focus
              </span>
            )}
            {goal && <GoalChip goal={goal} />}
            {task.estimatedMinutes ? (
              <span className="planner-task-estimate">{displayMinutes(task.estimatedMinutes)}</span>
            ) : null}
            {task.carriedFromDateKey && !done && (
              <span
                className="planner-task-carried"
                title={`Planned for ${relativeDayLabel(task.carriedFromDateKey, todayKey)} and carried over`}
              >
                <CornerDownRight size={10} aria-hidden="true" />
                {shortWeekday(task.carriedFromDateKey)}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="planner-task-actions">
        {canStart && onStart && !done && (
          <button
            type="button"
            className="planner-icon-button is-accent"
            aria-label={`Start working on ${task.text}`}
            title="Start working (⌘↵)"
            onClick={onStart}
          >
            <Play size={12} fill="currentColor" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="planner-icon-button"
          aria-label={`Actions for ${task.text}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={menu.openBelow}
        >
          <MoreHorizontal size={14} aria-hidden="true" />
        </button>
        <AnchoredMenu
          anchor={menu.anchor}
          onClose={menu.close}
          onClosed={() => {
            if (!cardRef.current?.querySelector('textarea')) cardRef.current?.focus()
          }}
          className="min-w-[210px]"
        >
          {canStart && onStart && !done && (
            <>
              <DropdownMenuItem onSelect={onStart}>
                <Play size={14} />
                Start Working
                <DropdownMenuShortcut>⌘↵</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => planner.setCompleted(task, dateKey, !done)}>
            {done ? <Undo2 size={14} /> : <Check size={14} />}
            {done ? 'Mark as Not Done' : 'Mark as Done'}
            <DropdownMenuShortcut>Space</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => window.setTimeout(() => setEditing(true), 0)}>
            <Pencil size={14} />
            Rename
            <DropdownMenuShortcut>↵</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Target size={14} />
              Goal
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[200px]">
              <DropdownMenuRadioGroup
                value={task.goalId || ''}
                onValueChange={(value) =>
                  planner.updateTask(task, dateKey, { goalId: value || null })
                }
              >
                <DropdownMenuRadioItem value="">No Goal</DropdownMenuRadioItem>
                {activeGoals.length > 0 && <DropdownMenuSeparator />}
                {activeGoals.map((entry) => (
                  <DropdownMenuRadioItem key={entry.id} value={entry.id}>
                    <span className="flex min-w-0 items-center gap-2">
                      <GoalMark goal={entry} size={9} />
                      <span className="truncate">{entry.title}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Clock size={14} />
              Estimate
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={String(task.estimatedMinutes || 0)}
                onValueChange={(value) =>
                  planner.updateTask(task, dateKey, { estimatedMinutes: Number(value) || null })
                }
              >
                <DropdownMenuRadioItem value="0">None</DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {[
                  ...new Set([...ESTIMATES, task.estimatedMinutes || 15].sort((a, b) => a - b))
                ].map((minutes) => (
                  <DropdownMenuRadioItem key={minutes} value={String(minutes)}>
                    {displayMinutes(minutes)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {!done && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowRight size={14} />
                Move to
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {destinations.map((entry) => (
                  <DropdownMenuItem key={entry.key} onSelect={() => moveTo(entry.key, 999)}>
                    {entry.label}
                  </DropdownMenuItem>
                ))}
                {weekDays.length > 0 && <DropdownMenuSeparator />}
                {weekDays.map((key) => (
                  <DropdownMenuItem key={key} onSelect={() => moveTo(key, 999)}>
                    {relativeDayLabel(key, todayKey)}
                  </DropdownMenuItem>
                ))}
                {index > 0 && !isPast && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => moveTo(dateKey, 0)}>
                      {isToday ? 'Front of the Queue' : 'Top of the Day'}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => planner.deleteTask(task, dateKey)}
          >
            <Trash2 size={14} />
            Delete
            <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
          </DropdownMenuItem>
        </AnchoredMenu>
      </div>
    </div>
  )
}
