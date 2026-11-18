import { ChevronDown, ChevronRight } from 'lucide-react'
import { DragEvent, ReactElement, RefObject, useEffect, useRef, useState } from 'react'
import {
  dateFromKey,
  dropIndex,
  plannedMinutes,
  shortWeekday,
  type PlannerDay,
  type PlannerGoal,
  type PlannerTask,
  type PlannerWeek
} from '../../lib/plannerModel'
import { displayMinutes } from '../../lib/taskEstimate'
import { cn } from '../../lib/utils'
import { AddTask } from './AddTask'
import { TaskCard } from './TaskCard'
import type { Planner } from './usePlanner'

type DropTarget = { dateKey: string; beforeTaskId: string | null }

/**
 * The week as seven day columns. A task belongs to a day, not to a time: drag
 * it within a column to set its place in that day's queue, or across columns
 * to plan it for another day.
 */
export function WeekBoard({
  week,
  goals,
  planner,
  goalFilter,
  activeTaskId,
  canStart,
  onStart,
  todayInputRef
}: {
  week: PlannerWeek
  goals: PlannerGoal[]
  planner: Planner
  goalFilter: Set<string>
  activeTaskId: string | null
  canStart: boolean
  onStart: (task: PlannerTask) => void
  todayInputRef: RefObject<HTMLInputElement | null>
}): ReactElement {
  const [dragged, setDragged] = useState<{ task: PlannerTask; dateKey: string } | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const [showDone, setShowDone] = useState<Record<string, boolean>>({})
  const boardRef = useRef<HTMLDivElement>(null)
  const { todayKey } = week
  const matches = (task: PlannerTask) =>
    goalFilter.size === 0 || goalFilter.has(task.goalId || 'none')
  const soleGoal = goalFilter.size === 1 && !goalFilter.has('none') ? [...goalFilter][0] : null

  // Bring today into view when the week is shown in a narrow window.
  useEffect(() => {
    boardRef.current
      ?.querySelector('[data-today="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [week.weekStartKey])

  const overColumn = (event: DragEvent, day: PlannerDay) => {
    if (!dragged || (day.dateKey < todayKey && day.dateKey !== dragged.dateKey)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    // Find the card the pointer is above; the drop goes before it.
    const cards = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('.planner-day-open [data-task-id]')
    ]
    const before = cards.find((card) => {
      const box = card.getBoundingClientRect()
      return event.clientY < box.top + box.height / 2
    })
    const beforeTaskId = before?.dataset.taskId || null
    if (target?.dateKey !== day.dateKey || target.beforeTaskId !== beforeTaskId)
      setTarget({ dateKey: day.dateKey, beforeTaskId })
  }
  const drop = (day: PlannerDay) => {
    if (!dragged || !target || target.dateKey !== day.dateKey) return
    const toIndex = dropIndex(day, dragged.task.id, target.beforeTaskId)
    const unchanged = dragged.dateKey === day.dateKey && toIndex === dragged.task.position
    if (!unchanged)
      planner.moveTask(dragged.task, dragged.dateKey, day.dateKey, toIndex, {
        fromIndex: dragged.task.position
      })
    setDragged(null)
    setTarget(null)
  }

  return (
    <div
      ref={boardRef}
      className="planner-board"
      role="group"
      aria-label="Plan of the week"
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null)
      }}
    >
      {week.days.map((day) => {
        const date = dateFromKey(day.dateKey)
        const isToday = day.dateKey === todayKey
        const isPast = day.dateKey < todayKey
        const total = day.open.length + day.done.length
        const minutes = plannedMinutes(day.open)
        const doneVisible = showDone[day.dateKey] ?? isPast
        const isTarget = target?.dateKey === day.dateKey
        return (
          <section
            key={day.dateKey}
            className={cn(
              'planner-day',
              isToday && 'is-today',
              isPast && 'is-past',
              isTarget && 'is-drop-target'
            )}
            data-today={isToday || undefined}
            aria-label={date.toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long'
            })}
            onDragOver={(event) => overColumn(event, day)}
            onDrop={(event) => {
              event.preventDefault()
              drop(day)
            }}
          >
            <header className="planner-day-header">
              <span className="planner-day-name">{shortWeekday(day.dateKey)}</span>
              <span className="planner-day-number">{date.getDate()}</span>
              <span className="planner-day-count">
                {total === 0
                  ? ''
                  : day.open.length === 0
                    ? 'All done'
                    : `${day.open.length} to do${minutes ? ` · ${displayMinutes(minutes)}` : ''}`}
              </span>
            </header>
            <div className="planner-day-scroll">
              <div className="planner-day-open" role="list">
                {day.open.map((task, index) => (
                  <div key={task.id} className="planner-slot">
                    {isTarget &&
                      target?.beforeTaskId === task.id &&
                      dragged?.task.id !== task.id && (
                        <div className="planner-drop-line" aria-hidden="true" />
                      )}
                    <TaskCard
                      task={task}
                      dateKey={day.dateKey}
                      todayKey={todayKey}
                      goals={goals}
                      planner={planner}
                      index={index}
                      openCount={day.open.length}
                      dimmed={!matches(task)}
                      inFocus={activeTaskId === task.id}
                      canStart={isToday && canStart}
                      onStart={() => onStart(task)}
                      dragging={dragged?.task.id === task.id}
                      onDragStart={() => setDragged({ task, dateKey: day.dateKey })}
                      onDragEnd={() => {
                        setDragged(null)
                        setTarget(null)
                      }}
                    />
                  </div>
                ))}
                {isTarget && target?.beforeTaskId === null && (
                  <div className="planner-drop-line" aria-hidden="true" />
                )}
              </div>
              {!isPast && (
                <AddTask
                  ref={isToday ? todayInputRef : undefined}
                  dateKey={day.dateKey}
                  goals={goals}
                  planner={planner}
                  defaultGoalId={soleGoal}
                  label={`New task for ${date.toLocaleDateString(undefined, { weekday: 'long' })}`}
                />
              )}
              {isPast && total === 0 && <p className="planner-day-empty">Nothing planned</p>}
              {day.done.length > 0 && (
                <div className="planner-day-done">
                  <button
                    type="button"
                    className="planner-disclosure"
                    aria-expanded={doneVisible}
                    onClick={() =>
                      setShowDone((current) => ({ ...current, [day.dateKey]: !doneVisible }))
                    }
                  >
                    {doneVisible ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    {day.done.length} done
                  </button>
                  {doneVisible && (
                    <div role="list">
                      {day.done.map((task, index) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          dateKey={day.dateKey}
                          todayKey={todayKey}
                          goals={goals}
                          planner={planner}
                          index={index}
                          openCount={0}
                          dimmed={!matches(task)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
