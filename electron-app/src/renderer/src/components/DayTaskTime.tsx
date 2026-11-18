import { Check } from 'lucide-react'
import { ReactElement, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import type { TaskTimeSummary } from '../lib/activitySessions'
import {
  goalColorVar,
  keyFromDate,
  weekStartOf,
  type PlannerGoal,
  type PlannerTask,
  type PlannerWeek
} from '../lib/plannerModel'
import { cn } from '../lib/utils'
import { trpc } from '../utils/trpc'
import '../styles/planner.css'

interface DayTaskTimeProps {
  date: Date
  tasks: TaskTimeSummary[]
}

const timeLabel = (value: Date) =>
  value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

const estimateLabel = (minutes: number) =>
  minutes >= 60
    ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`
    : `${minutes}m`

interface Row {
  id: string
  title: string
  time: TaskTimeSummary | null
  planned: PlannerTask | null
  goal: PlannerGoal | null
}

/**
 * The day's planned tasks with the time that actually went into each one.
 * It sits above the timeline so a day can be read by task as well as by hour.
 */
export function DayTaskTime({ date, tasks }: DayTaskTimeProps): ReactElement | null {
  const { token } = useAuth()
  const auth = { token: token || '' }
  const dateKey = keyFromDate(date)
  const { data: source } = trpc.planner.getSource.useQuery(auth, { enabled: !!token })
  const usesPlanner = source?.source === 'planner'
  const { data: week } = trpc.planner.getWeek.useQuery(
    { ...auth, weekStartKey: weekStartOf(dateKey) },
    { enabled: !!token && usesPlanner }
  )
  const { data: goals } = trpc.planner.getGoals.useQuery(auth, { enabled: !!token && usesPlanner })

  const rows = useMemo<Row[]>(() => {
    const allPlanned = ((week as PlannerWeek | undefined)?.days || []).flatMap((day) => [
      ...day.open,
      ...day.done
    ])
    const plannedById = new Map(allPlanned.map((task) => [task.id, task]))
    const goalById = new Map(((goals as PlannerGoal[] | undefined) || []).map((g) => [g.id, g]))
    const goalOf = (task: PlannerTask | null) => (task?.goalId && goalById.get(task.goalId)) || null
    const timed: Row[] = tasks.map((time) => {
      const planned = plannedById.get(time.taskId) || null
      return {
        id: time.taskId,
        title: planned?.text || time.title,
        time,
        planned,
        goal: goalOf(planned)
      }
    })
    const timedIds = new Set(tasks.map((task) => task.taskId))
    const day = (week as PlannerWeek | undefined)?.days.find((entry) => entry.dateKey === dateKey)
    const untimed: Row[] = (day?.done || [])
      .filter((task) => !timedIds.has(task.id))
      .map((task) => ({
        id: task.id,
        title: task.text,
        time: null,
        planned: task,
        goal: goalOf(task)
      }))
    return [...timed, ...untimed]
  }, [tasks, week, goals, dateKey])

  if (!rows.length) return null
  const totalMs = tasks.reduce((total, task) => total + task.trackedMs, 0)
  const doneCount = rows.filter((row) => row.planned?.completedAtMs).length

  return (
    <section className="planner-day-tasks" aria-label="Time per task">
      <div className="planner-day-tasks-header">
        <h3>Tasks</h3>
        <span>
          {rows.length} {rows.length === 1 ? 'task' : 'tasks'}
          {doneCount > 0 && ` · ${doneCount} done`}
          {totalMs > 0 && ` · ${formatDuration(totalMs)} tracked`}
        </span>
      </div>
      <ul>
        {rows.map(({ id, title, time, planned, goal }) => {
          const done = !!planned?.completedAtMs
          const estimate = planned?.estimatedMinutes || null
          const over = !!time && !!estimate && time.trackedMs > estimate * 60_000 * 1.1
          return (
            <li key={id} className={cn('planner-day-task', done && 'is-done')}>
              <span
                className={cn(
                  'planner-day-task-state',
                  done && 'is-done',
                  time?.isRunning && 'is-running'
                )}
                role="img"
                aria-label={done ? 'Done' : time?.isRunning ? 'In progress' : 'Not finished'}
              >
                {done && <Check size={10} strokeWidth={3} aria-hidden="true" />}
              </span>
              <div className="planner-day-task-main">
                <span className="planner-day-task-title">{title}</span>
                <span className="planner-day-task-meta">
                  {goal && (
                    <span className="planner-day-task-goal">
                      <span
                        className="planner-goal-mark"
                        style={{ width: 7, height: 7, color: goalColorVar(goal.color) }}
                        aria-hidden="true"
                      />
                      {goal.title}
                    </span>
                  )}
                  {time ? (
                    <>
                      <span>
                        {timeLabel(time.startTime)}–
                        {time.isRunning ? 'now' : timeLabel(time.endTime)}
                      </span>
                      {time.sessionCount > 1 && <span>{time.sessionCount} sessions</span>}
                      {time.distractedMs >= 60_000 && (
                        <span>{formatDuration(time.distractedMs)} distracted</span>
                      )}
                    </>
                  ) : (
                    <span>Marked done without a focus session</span>
                  )}
                </span>
              </div>
              {time && (
                <div className="planner-day-task-time">
                  <span className={cn(over && 'is-over')}>
                    {formatDuration(time.trackedMs) || '0m'}
                    {estimate && <em> of {estimateLabel(estimate)}</em>}
                  </span>
                  <div
                    className="tempo-timeline-rail"
                    role="img"
                    aria-label={`${formatDuration(time.focusedMs)} focused, ${formatDuration(time.distractedMs)} distracted${time.uncertainMs ? `, ${formatDuration(time.uncertainMs)} uncertain` : ''}`}
                  >
                    {time.focusedMs > 0 && (
                      <span className="is-focused" style={{ flexGrow: time.focusedMs }} />
                    )}
                    {time.distractedMs > 0 && (
                      <span className="is-distracted" style={{ flexGrow: time.distractedMs }} />
                    )}
                    {time.uncertainMs > 0 && (
                      <span className="is-uncertain" style={{ flexGrow: time.uncertainMs }} />
                    )}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
