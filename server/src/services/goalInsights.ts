import type { InsightSuggestion } from './insights';
import { formatMinutes, percent } from './insightFormat';

/**
 * Long-term goal accountability for the Analysis page.
 *
 * A goal collects time through the planner tasks linked to it: every focus
 * session phase spent on such a task counts toward the goal, whatever day the
 * task was planned for. The module compares that time with the goal's weekly
 * target (scaled to the period and pro-rated while the period is running),
 * with the same stretch of the previous period, and turns the clearest gaps
 * into a few concrete suggestions. It is pure so it can be tested without Mongo.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export interface GoalInsightGoal {
  id: string;
  title: string;
  color: string;
  icon: string;
  completedAtMs: number | null;
  weeklyTargetMinutes: number | null;
  createdAtMs: number | null;
}

export interface GoalPlannerInput {
  goals: GoalInsightGoal[];
  /** Planner task id to the goal it is linked to. */
  taskGoals: Record<string, string>;
  /** Open tasks per goal, the next one first. */
  openTasks: Record<string, string[]>;
}

/** Time on the clock in one work phase, with what the classifier saw in it. */
export interface GoalPhaseWork {
  taskId: string | null;
  workMs: number;
  focusedMs: number;
  distractedMs: number;
}

export type GoalStatus = 'reached' | 'on_pace' | 'behind' | 'no_target' | 'untouched';

export interface GoalAnalysisRow {
  id: string;
  title: string;
  color: string;
  icon: string;
  achieved: boolean;
  workMs: number;
  focusedMs: number;
  focusRate: number | null;
  sessions: number;
  /** Share of all time in focus sessions this period. */
  share: number | null;
  previousWorkMs: number;
  targetMs: number | null;
  expectedByNowMs: number | null;
  status: GoalStatus;
  openTasks: number;
  nextTask: string | null;
}

export interface GoalsAnalysis {
  totalWorkMs: number;
  linkedMs: number;
  unlinkedMs: number;
  previousLinkedMs: number;
  goals: GoalAnalysisRow[];
  suggestions: InsightSuggestion[];
}

const rate = (focusedMs: number, distractedMs: number) =>
  focusedMs + distractedMs >= 5 * MINUTE ? focusedMs / (focusedMs + distractedMs) : null;

const startOfDay = (ms: number) => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export const analyzeGoals = (args: {
  planner: GoalPlannerInput;
  phases: GoalPhaseWork[];
  previousPhases: GoalPhaseWork[];
  startDateMs: number;
  endDateMs: number;
  effectiveEndMs: number;
  /** Two-hour window with the best focus, if the period has one. */
  bestWindow?: string | null;
}): GoalsAnalysis => {
  const { planner, startDateMs, endDateMs, effectiveEndMs } = args;
  const goalOf = (taskId: string | null) => (taskId ? planner.taskGoals[taskId] || null : null);
  const known = new Set(planner.goals.map((goal) => goal.id));

  const totals = new Map<string, { workMs: number; focusedMs: number; distractedMs: number; sessions: number }>();
  let totalWorkMs = 0;
  let linkedMs = 0;
  for (const phase of args.phases) {
    totalWorkMs += phase.workMs;
    const goalId = goalOf(phase.taskId);
    if (!goalId || !known.has(goalId)) continue;
    linkedMs += phase.workMs;
    const entry = totals.get(goalId) || { workMs: 0, focusedMs: 0, distractedMs: 0, sessions: 0 };
    entry.workMs += phase.workMs;
    entry.focusedMs += phase.focusedMs;
    entry.distractedMs += phase.distractedMs;
    entry.sessions += 1;
    totals.set(goalId, entry);
  }
  const previous = new Map<string, number>();
  let previousLinkedMs = 0;
  for (const phase of args.previousPhases) {
    const goalId = goalOf(phase.taskId);
    if (!goalId || !known.has(goalId)) continue;
    previousLinkedMs += phase.workMs;
    previous.set(goalId, (previous.get(goalId) || 0) + phase.workMs);
  }

  const periodMs = endDateMs - startDateMs;
  const inProgress = effectiveEndMs < endDateMs;
  const rows: GoalAnalysisRow[] = planner.goals
    .filter((goal) => {
      const achievedBefore = goal.completedAtMs !== null && goal.completedAtMs < startDateMs;
      const createdLater = goal.createdAtMs !== null && goal.createdAtMs >= endDateMs;
      return (!achievedBefore && !createdLater) || totals.has(goal.id);
    })
    .map((goal) => {
      const time = totals.get(goal.id) || { workMs: 0, focusedMs: 0, distractedMs: 0, sessions: 0 };
      const achieved = goal.completedAtMs !== null;
      // A goal set up halfway through the week is only held to the rest of it.
      const targetStartMs = Math.max(startDateMs, goal.createdAtMs !== null ? startOfDay(goal.createdAtMs) : startDateMs);
      const targetMs =
        goal.weeklyTargetMinutes && !achieved && targetStartMs < endDateMs
          ? Math.round((goal.weeklyTargetMinutes * MINUTE * (endDateMs - targetStartMs)) / WEEK)
          : null;
      // Pace counts whole days only: today is still open, so nobody is behind
      // on a Monday morning for not having worked yet.
      const paceUntilMs = inProgress ? startOfDay(effectiveEndMs) : endDateMs;
      const expectedByNowMs =
        targetMs !== null
          ? Math.round(targetMs * Math.min(1, Math.max(0, (paceUntilMs - targetStartMs) / (endDateMs - targetStartMs))))
          : null;
      let status: GoalStatus;
      if (targetMs !== null && expectedByNowMs !== null) {
        if (time.workMs >= targetMs) status = 'reached';
        else if (inProgress && (time.workMs >= expectedByNowMs * 0.85 || expectedByNowMs - time.workMs < 20 * MINUTE)) status = 'on_pace';
        else status = 'behind';
      } else status = time.workMs > 0 ? 'no_target' : 'untouched';
      const open = planner.openTasks[goal.id] || [];
      return {
        id: goal.id,
        title: goal.title,
        color: goal.color,
        icon: goal.icon,
        achieved,
        workMs: time.workMs,
        focusedMs: time.focusedMs,
        focusRate: rate(time.focusedMs, time.distractedMs),
        sessions: time.sessions,
        share: totalWorkMs >= MINUTE ? time.workMs / totalWorkMs : null,
        previousWorkMs: previous.get(goal.id) || 0,
        targetMs,
        expectedByNowMs,
        status,
        openTasks: open.length,
        nextTask: open[0] || null,
      };
    })
    .sort((a, b) => Number(a.achieved) - Number(b.achieved) || b.workMs - a.workMs);

  const analysis = {
    totalWorkMs,
    linkedMs,
    unlinkedMs: totalWorkMs - linkedMs,
    previousLinkedMs,
    goals: rows,
  };
  return {
    ...analysis,
    suggestions: buildGoalSuggestions(analysis, {
      periodWord: periodMs > 8 * DAY ? 'month' : 'week',
      inProgress,
      daysLeft: inProgress ? Math.max(1, Math.ceil((endDateMs - effectiveEndMs) / DAY)) : 0,
      bestWindow: args.bestWindow || null,
    }),
  };
};

/**
 * At most three goal suggestions, strongest first. Like the other insights,
 * each rule waits for enough evidence, so a quiet week stays quiet.
 */
export const buildGoalSuggestions = (
  analysis: Omit<GoalsAnalysis, 'suggestions'>,
  context: { periodWord: 'week' | 'month'; inProgress: boolean; daysLeft: number; bestWindow: string | null }
): InsightSuggestion[] => {
  const candidates: Array<InsightSuggestion & { weight: number }> = [];
  const { periodWord, inProgress, daysLeft, bestWindow } = context;
  const active = analysis.goals.filter((goal) => !goal.achieved);
  const next = (goal: GoalAnalysisRow) => (goal.nextTask ? ` Next up: “${goal.nextTask}”.` : ' Plan one task for it in the week.');

  for (const goal of active) {
    if (goal.status !== 'behind' || goal.targetMs === null || goal.expectedByNowMs === null) continue;
    if (inProgress) {
      const remainingMs = goal.targetMs - goal.workMs;
      const gapMs = goal.expectedByNowMs - goal.workMs;
      const perDayMs = Math.ceil(remainingMs / daysLeft / (5 * MINUTE)) * 5 * MINUTE;
      candidates.push({
        id: `goal-behind-${goal.id}`,
        kind: 'goal',
        title: `${goal.title} is falling behind`,
        body: `${formatMinutes(goal.workMs)} of the ${formatMinutes(goal.targetMs)} you planned for it this ${periodWord}. ${
          daysLeft === 1 ? `${formatMinutes(remainingMs)} today closes the gap.` : `About ${formatMinutes(perDayMs)} a day over the last ${daysLeft} days gets you there.`
        }${next(goal)}`,
        weight: 70 + Math.min(1, gapMs / goal.targetMs) * 30,
      });
    } else {
      candidates.push({
        id: `goal-short-${goal.id}`,
        kind: 'goal',
        title: `${goal.title} fell short`,
        body: `${formatMinutes(goal.workMs)} of the ${formatMinutes(goal.targetMs)} you planned (${percent(goal.workMs / goal.targetMs)}). Book its first session early next ${periodWord}, before other work fills the days.`,
        weight: 60 + (1 - goal.workMs / goal.targetMs) * 30,
      });
    }
  }

  // A goal with no target and no time: the easiest one to forget.
  for (const goal of active) {
    if (goal.status !== 'untouched') continue;
    candidates.push({
      id: `goal-untouched-${goal.id}`,
      kind: 'goal',
      title: `${goal.title} got no time this ${periodWord}`,
      body: goal.openTasks
        ? `It has ${plural(goal.openTasks, 'open task')}, but no session went into it.${next(goal)} Even one short session keeps it moving.`
        : 'No session went into it and nothing is planned. Plan one small task for it, or set it aside if it no longer matters.',
      weight: 62,
    });
  }

  // Momentum without a target: a goal that got much less than last time.
  for (const goal of active) {
    if (goal.targetMs !== null || goal.previousWorkMs < HOUR || goal.workMs >= goal.previousWorkMs * 0.5) continue;
    candidates.push({
      id: `goal-slipping-${goal.id}`,
      kind: 'goal',
      title: `${goal.title} is slipping`,
      body: `${formatMinutes(goal.workMs)} so far, down from ${formatMinutes(goal.previousWorkMs)} ${inProgress ? `at this point last ${periodWord}` : `last ${periodWord}`}. Setting a weekly target in Plan makes it easier to keep up.`,
      weight: 55,
    });
  }

  // Sessions for one goal drift much more than the others.
  const rated = active.filter((goal) => goal.focusRate !== null && goal.workMs >= HOUR);
  if (rated.length >= 2) {
    const sorted = [...rated].sort((a, b) => (a.focusRate as number) - (b.focusRate as number));
    const weakest = sorted[0];
    const others = sorted.slice(1);
    const othersRate = others.reduce((sum, goal) => sum + (goal.focusRate as number) * goal.workMs, 0) / others.reduce((sum, goal) => sum + goal.workMs, 0);
    if (othersRate - (weakest.focusRate as number) >= 0.15) {
      candidates.push({
        id: `goal-drift-${weakest.id}`,
        kind: 'goal',
        title: `Sessions on ${weakest.title} drift more`,
        body: `They ran at ${percent(weakest.focusRate as number)} focus, against ${percent(othersRate)} for your other goals.${
          bestWindow ? ` Try its tasks in your strongest hours, ${bestWindow}.` : ' Try its tasks earlier in the day, or split them into smaller steps.'
        }`,
        weight: 48,
      });
    }
  }

  // Much of the session time is not linked to any goal.
  if (active.length && analysis.totalWorkMs >= 2 * HOUR && analysis.unlinkedMs / analysis.totalWorkMs >= 0.4) {
    candidates.push({
      id: 'goal-unlinked',
      kind: 'goal',
      title: `${percent(analysis.unlinkedMs / analysis.totalWorkMs)} of your session time had no goal`,
      body: `${formatMinutes(analysis.unlinkedMs)} of ${formatMinutes(analysis.totalWorkMs)} went into tasks that are not linked to a goal. If they serve one, link them in the week plan so the time counts.`,
      weight: 40,
    });
  }

  for (const goal of active) {
    if (goal.status !== 'reached' || goal.targetMs === null) continue;
    candidates.push({
      id: `goal-reached-${goal.id}`,
      kind: 'momentum',
      title: `${goal.title}: target reached`,
      body: `${formatMinutes(goal.workMs)} against a target of ${formatMinutes(goal.targetMs)}${
        inProgress ? `, with ${plural(daysLeft, 'day')} to spare. Time on it from here is a bonus, or room for another goal.` : '. Keep the same rhythm next ' + periodWord + '.'
      }`,
      weight: 20,
    });
  }

  return candidates
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map(({ weight: _weight, ...suggestion }) => suggestion);
};
