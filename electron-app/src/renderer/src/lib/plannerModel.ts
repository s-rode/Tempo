import { parseTaskEstimate } from './taskEstimate'

/** Shared, side-effect-free model for the Plan page. */

export interface PlannerTask {
  id: string
  text: string
  estimatedMinutes?: number | null
  position: number
  completedAtMs: number | null
  goalId?: string | null
  carriedFromDateKey?: string | null
  /** Set on tasks made by or turned into a repeating task. */
  routineId?: string | null
  repeat?: RepeatRule | null
  /** The first day of the repeat, which sets the weekday of a weekly one. */
  repeatFromDateKey?: string | null
}

export type RepeatRule = 'daily' | 'weekdays' | 'weekly'

/** Menu and label wording for each repeat rule; weekly names the task's weekday. */
export const repeatLabel = (rule: RepeatRule, dateKey: string, short = false): string => {
  if (rule === 'daily') return short ? 'Daily' : 'Every Day'
  if (rule === 'weekdays') return short ? 'Weekdays' : 'Every Weekday'
  const weekday = dateFromKey(dateKey).toLocaleDateString('en-US', { weekday: 'long' })
  return short ? `${weekday}s` : `Every ${weekday}`
}

export interface PlannerGoal {
  id: string
  title: string
  notes: string
  color: string
  icon: string
  position: number
  completedAtMs: number | null
  /** Time a week the user means to give this goal, in minutes; null when unset. */
  weeklyTargetMinutes: number | null
  openTasks: number
  doneTasks: number
}

export interface PlannerDay {
  dateKey: string
  open: PlannerTask[]
  done: PlannerTask[]
}

export interface PlannerWeek {
  weekStartKey: string
  todayKey: string
  days: PlannerDay[]
}

export const GOAL_COLORS = [
  { id: 'blue', label: 'Blue' },
  { id: 'indigo', label: 'Indigo' },
  { id: 'purple', label: 'Purple' },
  { id: 'pink', label: 'Pink' },
  { id: 'red', label: 'Red' },
  { id: 'orange', label: 'Orange' },
  { id: 'yellow', label: 'Yellow' },
  { id: 'green', label: 'Green' },
  { id: 'mint', label: 'Mint' },
  { id: 'teal', label: 'Teal' },
  { id: 'graphite', label: 'Graphite' }
] as const
export type GoalColorId = (typeof GOAL_COLORS)[number]['id']

export const goalColorVar = (color: string | undefined | null): string =>
  `var(--planner-${GOAL_COLORS.some((entry) => entry.id === color) ? color : 'graphite'})`

export const dateFromKey = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

export const keyFromDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export const addDays = (dateKey: string, days: number): string => {
  const date = dateFromKey(dateKey)
  date.setDate(date.getDate() + days)
  return keyFromDate(date)
}

export const weekStartOf = (dateKey: string): string =>
  addDays(dateKey, -((dateFromKey(dateKey).getDay() + 6) % 7))

export const weekRangeLabel = (weekStartKey: string, locale?: string): string => {
  const start = dateFromKey(weekStartKey)
  const end = dateFromKey(addDays(weekStartKey, 6))
  const sameMonth = start.getMonth() === end.getMonth()
  const startText = start.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  const endText = end.toLocaleDateString(locale, {
    day: 'numeric',
    month: sameMonth ? undefined : 'short'
  })
  const endFull = sameMonth
    ? `${start.toLocaleDateString(locale, { month: 'short' })} ${start.getDate()}–${endText}`
    : `${startText} – ${endText}`
  return `${endFull}, ${end.getFullYear()}`
}

/** "Today", "Tomorrow", "Yesterday", otherwise the weekday. */
export const relativeDayLabel = (dateKey: string, todayKey: string, locale?: string): string => {
  if (dateKey === todayKey) return 'Today'
  if (dateKey === addDays(todayKey, 1)) return 'Tomorrow'
  if (dateKey === addDays(todayKey, -1)) return 'Yesterday'
  return dateFromKey(dateKey).toLocaleDateString(locale, { weekday: 'long' })
}

export const shortWeekday = (dateKey: string, locale?: string): string =>
  dateFromKey(dateKey).toLocaleDateString(locale, { weekday: 'short' })

export const plannedMinutes = (tasks: PlannerTask[]): number =>
  tasks.reduce((total, task) => total + (task.estimatedMinutes || 0), 0)

const compact = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Quick entry for a new task. A `#tag` at either end links a goal when it
 * matches the start of exactly one goal title (or one title exactly), and a
 * trailing duration such as "45m" or "1h 30m" becomes the time estimate.
 * Anything not recognized stays part of the title.
 */
/** How task names are compared; the server uses the same rule. */
export const taskNameKey = (text: string): string =>
  text.trim().replace(/\s+/g, ' ').replace(/\.+$/, '').toLocaleLowerCase()

/**
 * The goal a new task starts with: a "#goal" typed with it, else the goal the
 * view is filtered to, else the goal this name was last linked to.
 */
export function goalForNewTask(
  parsed: { text: string; goalId: string | null },
  defaultGoalId: string | null,
  remembered: Record<string, string> | undefined,
  goals: Pick<PlannerGoal, 'id' | 'completedAtMs'>[]
): { goalId: string | null; remembered: boolean } {
  if (parsed.goalId) return { goalId: parsed.goalId, remembered: false }
  if (defaultGoalId) return { goalId: defaultGoalId, remembered: false }
  const last = remembered?.[taskNameKey(parsed.text)]
  if (last && goals.some((goal) => goal.id === last && goal.completedAtMs === null))
    return { goalId: last, remembered: true }
  return { goalId: null, remembered: false }
}

export function parseQuickTask(
  input: string,
  goals: Pick<PlannerGoal, 'id' | 'title' | 'completedAtMs'>[]
): { text: string; goalId: string | null; estimatedMinutes: number | null } {
  const active = goals.filter((goal) => goal.completedAtMs === null)
  const resolve = (tag: string): string | null => {
    const wanted = compact(tag)
    if (!wanted) return null
    const exact = active.filter((goal) => compact(goal.title) === wanted)
    if (exact.length === 1) return exact[0].id
    const matching = active.filter(
      (goal) =>
        compact(goal.title).startsWith(wanted) ||
        goal.title.split(/\s+/).some((word) => compact(word).startsWith(wanted))
    )
    return matching.length === 1 ? matching[0].id : null
  }
  let text = input.trim()
  let goalId: string | null = null
  let estimatedMinutes: number | null = null
  const takeTag = () => {
    if (goalId) return
    const trailing = text.match(/^(.*\S)\s+#([\p{L}\p{N}_-]+)$/u)
    const leading = text.match(/^#([\p{L}\p{N}_-]+)\s+(\S.*)$/u)
    if (trailing && resolve(trailing[2])) {
      goalId = resolve(trailing[2])
      text = trailing[1].trim()
    } else if (leading && resolve(leading[1])) {
      goalId = resolve(leading[1])
      text = leading[2].trim()
    }
  }
  takeTag()
  const estimate = parseTaskEstimate(text)
  if (estimate.recognized) {
    text = estimate.title
    estimatedMinutes = estimate.estimatedMinutes
    // "Draft chapter 3 #thesis 45m": the tag only becomes trailing now.
    takeTag()
  }
  return { text, goalId, estimatedMinutes }
}

/** The same move the server performs, applied to cached data so drops feel instant. */
export function moveTaskInWeek(
  week: PlannerWeek,
  taskId: string,
  fromDateKey: string,
  toDateKey: string,
  toIndex: number
): PlannerWeek {
  const source = week.days.find((day) => day.dateKey === fromDateKey)
  const task = source?.open.find((entry) => entry.id === taskId)
  if (!source || !task) return week
  const renumber = (tasks: PlannerTask[]) =>
    tasks.map((entry, position) => ({ ...entry, position }))
  return {
    ...week,
    days: week.days.map((day) => {
      if (day.dateKey !== fromDateKey && day.dateKey !== toDateKey) return day
      let open = day.open.filter((entry) => entry.id !== taskId)
      if (day.dateKey === toDateKey) {
        const at = Math.max(0, Math.min(toIndex, open.length))
        open = [
          ...open.slice(0, at),
          fromDateKey === toDateKey ? task : { ...task, carriedFromDateKey: null },
          ...open.slice(at)
        ]
      }
      return { ...day, open: renumber(open) }
    })
  }
}

/** Index to send to the server when a task is dropped before `beforeTaskId` (or at the end). */
export function dropIndex(
  day: PlannerDay,
  draggedTaskId: string,
  beforeTaskId: string | null
): number {
  const others = day.open.filter((task) => task.id !== draggedTaskId)
  if (beforeTaskId === null) return others.length
  const index = others.findIndex((task) => task.id === beforeTaskId)
  return index < 0 ? others.length : index
}

export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/** "4 h", "1.5 h" or "45 min" for a weekly goal target. */
export const formatWeeklyTarget = (minutes: number): string =>
  minutes < 60 ? `${minutes} min` : `${Math.round((minutes / 60) * 10) / 10} h`
