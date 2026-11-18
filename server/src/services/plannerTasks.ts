import type { GoalTask } from '../models/goalPlan';

/** Pure helpers for the built-in planner. No database or clock access here. */

export const PLANNER_GOAL_COLORS = [
  'blue',
  'indigo',
  'purple',
  'pink',
  'red',
  'orange',
  'yellow',
  'green',
  'mint',
  'teal',
  'graphite',
] as const;
export type PlannerGoalColor = (typeof PLANNER_GOAL_COLORS)[number];

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export const isDateKey = (value: string): boolean => {
  if (!DATE_KEY.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

/** Local noon avoids daylight-saving edges when stepping through days. */
export const dateFromKey = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
};

export const keyFromDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const addDays = (dateKey: string, days: number): string => {
  const date = dateFromKey(dateKey);
  date.setDate(date.getDate() + days);
  return keyFromDate(date);
};

/** Monday of the week that contains `dateKey`. */
export const weekStartOf = (dateKey: string): string => {
  const date = dateFromKey(dateKey);
  return addDays(dateKey, -((date.getDay() + 6) % 7));
};

export const weekDayKeys = (weekStartKey: string): string[] =>
  Array.from({ length: 7 }, (_, index) => addDays(weekStartKey, index));

export const openTasks = (tasks: GoalTask[]): GoalTask[] =>
  tasks.filter((task) => task.completedAtMs === null).sort((a, b) => a.position - b.position);

export const doneTasks = (tasks: GoalTask[]): GoalTask[] =>
  tasks
    .filter((task) => task.completedAtMs !== null)
    .sort((a, b) => (a.completedAtMs || 0) - (b.completedAtMs || 0));

/** Open tasks in queue order with dense positions, followed by finished ones. */
export const normalizeTasks = (tasks: GoalTask[]): GoalTask[] => [
  ...openTasks(tasks).map((task, position) => ({ ...task, position })),
  ...doneTasks(tasks),
];

/** Inserts an open task at a queue index (clamped) and renumbers the queue. */
export const insertOpenTask = (tasks: GoalTask[], task: GoalTask, index: number): GoalTask[] => {
  const queue = openTasks(tasks.filter((entry) => entry.id !== task.id));
  const at = Math.max(0, Math.min(Math.trunc(index), queue.length));
  queue.splice(at, 0, { ...task, completedAtMs: null });
  return [...queue.map((entry, position) => ({ ...entry, position })), ...doneTasks(tasks)];
};

export const removeTask = (tasks: GoalTask[], taskId: string): GoalTask[] =>
  normalizeTasks(tasks.filter((task) => task.id !== taskId));

/**
 * Appends unfinished tasks from earlier days to today's queue. The day a task
 * was first planned for is kept so the interface can say where it came from.
 */
export const carryOver = (
  today: GoalTask[],
  earlier: Array<{ dateKey: string; tasks: GoalTask[] }>
): GoalTask[] => {
  const queue = openTasks(today);
  const known = new Set(today.map((task) => task.id));
  for (const day of [...earlier].sort((a, b) => a.dateKey.localeCompare(b.dateKey)))
    for (const task of openTasks(day.tasks)) {
      if (known.has(task.id)) continue;
      known.add(task.id);
      queue.push({ ...task, carriedFromDateKey: task.carriedFromDateKey || day.dateKey });
    }
  return [...queue.map((task, position) => ({ ...task, position })), ...doneTasks(today)];
};
