import crypto from 'crypto';
import type { FocusTaskSource } from '../../../shared/reminders';
import { FocusRunHistoryModel, FocusRuntimeModel } from '../models/focusRuntime';

export type SuspensionReason =
  | 'manual_pause'
  | 'pomodoro_break'
  | 'long_break'
  | 'awaiting_goal'
  | 'awaiting_system_resume'
  | 'screen_locked'
  | 'system_sleep';

export type FocusTransitionNoticeKind =
  | 'focus_complete'
  | 'break_started'
  | 'break_complete'
  | 'pomodoro_complete'
  | 'task_target_reached';

export interface FocusTransitionNotice {
  id: string;
  kind: FocusTransitionNoticeKind;
  runId: string;
  phaseId: string;
  phaseIndex: number;
  occurredAtMs: number;
  goal: string | null;
  breakDurationMs: number | null;
}

export type TodayPlanTaskSource = FocusTaskSource;
export const taskSourceSnapshot = (target: any): TodayPlanTaskSource => ({
  taskId: target.taskId,
  dateKey: target.dateKey,
  ...(target.source === 'reminder'
    ? {
        source: 'reminder',
        classificationText: target.classificationText,
        listId: target.listId,
        listName: target.listName,
        listContext: target.listContext,
      }
    : {}),
});

type RuntimeDocument = any;

const minute = 60_000;
const taskTargetFor = (run: any) => (run?.taskTarget?.taskId ? run.taskTarget : null);
const phaseElapsed = (current: any, now: number) =>
  current.activeElapsedMs +
  (current.state === 'running' && current.runningSinceMs
    ? Math.max(0, now - current.runningSinceMs)
    : 0);
const workElapsed = (run: any, now: number) =>
  (run?.phases || []).reduce(
    (total: number, entry: any) => total + (entry.kind === 'work' ? phaseElapsed(entry, now) : 0),
    0
  );
const phase = (
  kind: 'work' | 'short_break' | 'long_break',
  durationMinutes: number,
  state: string,
  goal: string | null = null,
  todayPlanTask: TodayPlanTaskSource | null = null,
  now = Date.now()
) => ({
  id: crypto.randomUUID(),
  kind,
  goal,
  todayPlanTask: todayPlanTask ? { ...todayPlanTask } : null,
  goalHistory:
    kind === 'work' && goal && state === 'running'
      ? [{ goal, todayPlanTask: todayPlanTask ? { ...todayPlanTask } : null, startedAtMs: now }]
      : [],
  startedAtMs: state === 'running' ? now : null,
  completedAtMs: null,
  plannedDurationMs: durationMinutes * minute,
  activeElapsedMs: 0,
  runningSinceMs: state === 'running' ? now : null,
  state,
  productiveMs: 0,
  distractedMs: 0,
});

const hasSystemSuspension = (runtime: RuntimeDocument) =>
  runtime.systemLocked || runtime.systemSleeping;

const currentPhase = (runtime: RuntimeDocument) =>
  runtime.run?.state === 'active'
    ? runtime.run.phases?.[runtime.run.currentPhaseIndex] || null
    : null;

/**
 * A Pomodoro waiting for its next goal and an explicit manual pause already
 * define a safe accounting boundary. Waiting for a capture that those states
 * intentionally prevent would deadlock the runtime after wake.
 */
const shouldAwaitFreshSystemCapture = (runtime: RuntimeDocument, now = Date.now()) => {
  if (runtime.manualPauseUntilMs && runtime.manualPauseUntilMs > now) return false;
  const current = currentPhase(runtime);
  // Breaks deliberately suspend foreground capture. Requiring a capture to
  // resume the break after wake would wait for an event that cannot arrive.
  return (
    current?.state !== 'awaiting_goal' &&
    current?.kind !== 'short_break' &&
    current?.kind !== 'long_break'
  );
};

const freezePhase = (runtime: RuntimeDocument, now: number) => {
  const current = currentPhase(runtime);
  if (!current || current.state !== 'running' || !current.runningSinceMs) return;
  current.activeElapsedMs = taskTargetFor(runtime.run)?.checkpointAtMs
    ? phaseElapsed(current, now)
    : Math.min(current.plannedDurationMs, phaseElapsed(current, now));
  current.runningSinceMs = null;
  current.state = 'suspended';
};

const resumePhase = (runtime: RuntimeDocument, now: number) => {
  const current = currentPhase(runtime);
  if (!current || current.state === 'awaiting_goal' || current.state === 'completed') return;
  if (
    runtime.manualPauseUntilMs ||
    hasSystemSuspension(runtime) ||
    runtime.awaitingSystemResumeCapture
  )
    return;
  current.state = 'running';
  current.runningSinceMs = now;
};

const completeRun = (runtime: RuntimeDocument, now: number, state: 'completed' | 'cancelled') => {
  if (!runtime.run) return;
  freezePhase(runtime, now);
  const current = currentPhase(runtime);
  if (current && current.state !== 'completed') {
    current.state = 'completed';
    current.runningSinceMs = null;
    current.completedAtMs = now;
  }
  runtime.run.state = state;
  runtime.run.completedAtMs = now;
};

export async function archiveFinishedRun(runtime: RuntimeDocument): Promise<void> {
  const run = runtime.run;
  if (!run || run.state === 'active' || !run.completedAtMs) return;
  await FocusRunHistoryModel.updateOne(
    { runId: run.id },
    {
      $setOnInsert: {
        userId: String(runtime.userId),
        runId: run.id,
        run: run.toObject ? run.toObject() : run,
        endedAtMs: run.completedAtMs,
        outcome: run.state,
      },
    },
    { upsert: true }
  );
  runtime.run = null;
}

const recordTransitionNotice = (
  runtime: RuntimeDocument,
  notice: Omit<FocusTransitionNotice, 'id' | 'occurredAtMs'>,
  now: number
) => {
  runtime.transitionNotice = {
    ...notice,
    id: crypto.randomUUID(),
    occurredAtMs: now,
  };
  // A new notice must never be hidden by acknowledgement of an earlier one.
  runtime.acknowledgedTransitionNoticeId = null;
};

const advancePhase = (
  runtime: RuntimeDocument,
  now: number,
  options: { emitTransitionNotice?: boolean } = {}
) => {
  const run = runtime.run;
  const current = currentPhase(runtime);
  if (!run || !current) return;
  const phaseIndex = run.currentPhaseIndex;
  const completedGoal = current.goal || null;
  const taskTarget = taskTargetFor(run);
  if (taskTarget && current.kind === 'work' && phaseIndex === run.phases.length - 1) {
    // Reaching a planned task target is a decision, not an automatic end.
    // Keep the work phase running so overtime remains real work time.
    taskTarget.checkpointAtMs = now;
    if (options.emitTransitionNotice) {
      recordTransitionNotice(
        runtime,
        {
          kind: 'task_target_reached',
          runId: run.id,
          phaseId: current.id,
          phaseIndex,
          goal: taskTarget.goalSnapshot || completedGoal,
          breakDurationMs: null,
        },
        now
      );
    }
    return;
  }
  current.activeElapsedMs = current.plannedDurationMs;
  current.runningSinceMs = null;
  current.state = 'completed';
  current.completedAtMs = now;

  if (run.kind === 'custom' || current.kind === 'long_break') {
    if (options.emitTransitionNotice) {
      recordTransitionNotice(
        runtime,
        {
          kind: run.kind === 'custom' ? 'focus_complete' : 'pomodoro_complete',
          runId: run.id,
          phaseId: current.id,
          phaseIndex,
          goal:
            run.kind === 'custom'
              ? completedGoal
              : [...run.phases].reverse().find((candidate: any) => candidate.kind === 'work')
                  ?.goal || null,
          breakDurationMs: null,
        },
        now
      );
    }
    completeRun(runtime, now, 'completed');
    return;
  }

  run.currentPhaseIndex += 1;
  const next = currentPhase(runtime);
  if (!next) {
    completeRun(runtime, now, 'completed');
    return;
  }
  if (next.kind === 'work') {
    if (taskTarget) {
      next.state = 'running';
      next.runningSinceMs = now;
      next.startedAtMs = now;
      next.goalHistory = [
        {
          goal: taskTarget.goalSnapshot,
          todayPlanTask: taskSourceSnapshot(taskTarget),
          startedAtMs: now,
        },
      ];
      next.todayPlanTask = taskSourceSnapshot(taskTarget);
    } else {
      next.state = 'awaiting_goal';
      next.runningSinceMs = null;
      next.startedAtMs = null;
    }
  } else {
    next.state = 'running';
    next.runningSinceMs = now;
    next.startedAtMs = now;
  }

  if (options.emitTransitionNotice) {
    recordTransitionNotice(
      runtime,
      {
        kind: current.kind === 'work' ? 'break_started' : 'break_complete',
        runId: run.id,
        phaseId: current.id,
        phaseIndex,
        goal: current.kind === 'work' ? completedGoal : taskTarget?.goalSnapshot || null,
        breakDurationMs: current.kind === 'work' ? next.plannedDurationMs : null,
      },
      now
    );
  }
};

/** Applies timer expiry using server time. It never charges time while suspended. */
export const advanceRuntime = (
  runtime: RuntimeDocument,
  now = Date.now(),
  options: { emitTransitionNotice?: boolean } = {}
) => {
  // A native lock/sleep boundary and the deliberate fresh-capture gate are
  // authoritative. Never complete a phase or emit an alert while either is
  // active, even if a legacy record still says the phase was running.
  if (hasSystemSuspension(runtime) || runtime.awaitingSystemResumeCapture) return null;
  if (
    runtime.manualPauseUntilMs &&
    now >= runtime.manualPauseUntilMs &&
    !hasSystemSuspension(runtime)
  ) {
    runtime.manualPauseUntilMs = null;
    runtime.manualPausedAtMs = null;
    resumePhase(runtime, now);
  }
  const current = currentPhase(runtime);
  if (!current || current.state !== 'running' || !current.runningSinceMs) return;
  if (taskTargetFor(runtime.run)?.checkpointAtMs) return null;
  const elapsed = current.activeElapsedMs + Math.max(0, now - current.runningSinceMs);
  if (elapsed < current.plannedDurationMs) return null;
  advancePhase(runtime, now, options);
  return runtime.transitionNotice as FocusTransitionNotice | null;
};

export async function getOrCreateRuntime(userId: string): Promise<RuntimeDocument> {
  return FocusRuntimeModel.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, new: true }
  );
}

export const suspensionReasonsFor = (runtime: RuntimeDocument): SuspensionReason[] => {
  const reasons: SuspensionReason[] = [];
  if (runtime.manualPauseUntilMs) reasons.push('manual_pause');
  if (runtime.systemLocked) reasons.push('screen_locked');
  if (runtime.systemSleeping) reasons.push('system_sleep');
  if (runtime.awaitingSystemResumeCapture) reasons.push('awaiting_system_resume');
  const current = currentPhase(runtime);
  if (current?.state === 'awaiting_goal') reasons.push('awaiting_goal');
  if (current?.kind === 'short_break' && current.state === 'running')
    reasons.push('pomodoro_break');
  if (current?.kind === 'long_break' && current.state === 'running') reasons.push('long_break');
  return reasons;
};

export const runtimeSnapshot = (runtime: RuntimeDocument, now = Date.now()) => {
  advanceRuntime(runtime, now);
  const current = currentPhase(runtime);
  const reasons = suspensionReasonsFor(runtime);
  const phaseElapsedMs = current
    ? taskTargetFor(runtime.run)?.checkpointAtMs
      ? phaseElapsed(current, now)
      : Math.min(current.plannedDurationMs, phaseElapsed(current, now))
    : 0;
  const trackingState = reasons.length
    ? current?.kind === 'short_break' || current?.kind === 'long_break'
      ? 'break'
      : 'paused'
    : runtime.run?.state === 'active'
      ? 'active'
      : 'normal';
  const runValue = runtime.run?.toObject ? runtime.run.toObject() : runtime.run;
  const phaseValue = current?.toObject ? current.toObject() : current;
  const pendingNotice = runtime.transitionNotice;
  const transitionNotice =
    pendingNotice?.id && pendingNotice.id !== runtime.acknowledgedTransitionNoticeId
      ? pendingNotice.toObject
        ? pendingNotice.toObject()
        : pendingNotice
      : null;
  const taskTarget = taskTargetFor(runtime.run);
  const nextDeadlineAtMs = runtime.manualPauseUntilMs
    ? runtime.manualPauseUntilMs
    : !taskTarget?.checkpointAtMs && current?.state === 'running' && current.runningSinceMs
      ? current.runningSinceMs + Math.max(0, current.plannedDurationMs - current.activeElapsedMs)
      : null;
  return {
    mode: runtime.run?.state === 'active' ? runtime.run.kind : 'normal',
    trackingState,
    suspension: {
      reasons,
      pausedUntilMs: runtime.manualPauseUntilMs || null,
      manualPausedAtMs: runtime.manualPausedAtMs || null,
      suspendedAtMs: runtime.systemSuspendedAtMs || null,
    },
    run: runtime.run?.state === 'active' ? runValue : null,
    currentPhase: current ? { ...phaseValue, activeElapsedMs: phaseElapsedMs } : null,
    phaseRemainingMs: current ? Math.max(0, current.plannedDurationMs - phaseElapsedMs) : null,
    taskProgress: taskTarget
      ? {
          taskId: taskTarget.taskId,
          dateKey: taskTarget.dateKey,
          source: taskTarget.source || 'manual',
          goal: taskTarget.goalSnapshot,
          estimatedMinutes: taskTarget.estimatedMinutes,
          workTargetMs: taskTarget.workTargetMs,
          workElapsedMs: workElapsed(runtime.run, now),
          checkpointAtMs: taskTarget.checkpointAtMs || null,
          sampledAtMs: now,
        }
      : null,
    nextDeadlineAtMs,
    transitionNotice,
    revision: runtime.revision || 0,
  };
};

export async function saveRuntime(
  runtime: RuntimeDocument,
  options: { rearmScheduler?: boolean } = {}
) {
  runtime.revision = (runtime.revision || 0) + 1;
  await runtime.save();
  if (options.rearmScheduler !== false) {
    // Avoid a static circular dependency: the scheduler invokes this helper
    // after it advances a deadline, while ordinary runtime mutations re-arm it.
    void import('./focusRuntimeScheduler').then(({ armFocusRuntimeDeadline }) =>
      armFocusRuntimeDeadline(String(runtime.userId))
    );
  }
  return runtime;
}

export async function setSystemSuspension(
  userId: string,
  kind: 'lock' | 'unlock' | 'sleep' | 'wake'
) {
  const runtime = await getOrCreateRuntime(userId);
  const now = Date.now();
  if (kind === 'lock' || kind === 'sleep') {
    freezePhase(runtime, now);
    if (!runtime.systemSuspendedAtMs) runtime.systemSuspendedAtMs = now;
  }
  if (kind === 'lock') runtime.systemLocked = true;
  if (kind === 'sleep') runtime.systemSleeping = true;
  if (kind === 'unlock') runtime.systemLocked = false;
  if (kind === 'wake') runtime.systemSleeping = false;
  if (!hasSystemSuspension(runtime)) {
    runtime.systemSuspendedAtMs = null;
    runtime.awaitingSystemResumeCapture = shouldAwaitFreshSystemCapture(runtime, now);
  }
  if (
    !hasSystemSuspension(runtime) &&
    !runtime.awaitingSystemResumeCapture &&
    (!runtime.manualPauseUntilMs || now >= runtime.manualPauseUntilMs)
  ) {
    if (runtime.manualPauseUntilMs && now >= runtime.manualPauseUntilMs) {
      runtime.manualPauseUntilMs = null;
      runtime.manualPausedAtMs = null;
    }
    resumePhase(runtime, now);
  }
  await saveRuntime(runtime);
  return runtimeSnapshot(runtime, now);
}

/**
 * Clears a stale native lock/sleep state after the user has already returned
 * to their desktop. The next stable foreground capture remains the boundary
 * that resumes phase timing, so no wake interval is charged as focus time.
 */
export async function resumeFromStaleSystemSuspension(userId: string) {
  const runtime = await getOrCreateRuntime(userId);
  runtime.systemLocked = false;
  runtime.systemSleeping = false;
  runtime.systemSuspendedAtMs = null;
  runtime.awaitingSystemResumeCapture = shouldAwaitFreshSystemCapture(runtime);
  await saveRuntime(runtime);
  return runtimeSnapshot(runtime);
}

/** Starts phase timing only after native monitoring has committed a fresh activity. */
export async function resumeAfterSystemCapture(userId: string) {
  const runtime = await getOrCreateRuntime(userId);
  if (!runtime.awaitingSystemResumeCapture || hasSystemSuspension(runtime))
    return runtimeSnapshot(runtime);
  const now = Date.now();
  runtime.awaitingSystemResumeCapture = false;
  if (!runtime.manualPauseUntilMs || now >= runtime.manualPauseUntilMs) {
    if (runtime.manualPauseUntilMs && now >= runtime.manualPauseUntilMs) {
      runtime.manualPauseUntilMs = null;
      runtime.manualPausedAtMs = null;
    }
    resumePhase(runtime, now);
  }
  await saveRuntime(runtime);
  return runtimeSnapshot(runtime, now);
}

export async function acknowledgeTransitionNotice(userId: string, noticeId: string) {
  const runtime = await getOrCreateRuntime(userId);
  if (runtime.transitionNotice?.id === noticeId) {
    runtime.acknowledgedTransitionNoticeId = noticeId;
    await saveRuntime(runtime);
  }
  return runtimeSnapshot(runtime);
}

export const createCustomRun = (
  goal: string,
  durationMinutes: number,
  now = Date.now(),
  todayPlanTask: TodayPlanTaskSource | null = null,
  originalEstimateMinutes: number | null = null
) => ({
  id: crypto.randomUUID(),
  kind: 'custom',
  state: 'active',
  currentPhaseIndex: 0,
  phases: [
    {
      ...phase('work', durationMinutes, 'running', goal, todayPlanTask, now),
      runningSinceMs: now,
      startedAtMs: now,
    },
  ],
  taskTarget: todayPlanTask
    ? {
        ...todayPlanTask,
        goalSnapshot: goal,
        estimatedMinutes: originalEstimateMinutes,
        workTargetMs: durationMinutes * minute,
        checkpointAtMs: null,
      }
    : null,
  startedAtMs: now,
  completedAtMs: null,
});

export const createPomodoroRun = (
  firstGoal: string,
  now = Date.now(),
  todayPlanTask: TodayPlanTaskSource | null = null,
  workTargetMinutes: number | null = null,
  originalEstimateMinutes: number | null = null
) => ({
  id: crypto.randomUUID(),
  kind: 'pomodoro',
  state: 'active',
  currentPhaseIndex: 0,
  phases:
    todayPlanTask && workTargetMinutes
      ? Array.from({ length: Math.ceil(workTargetMinutes / 30) }, (_, index) => {
          const blockMinutes = Math.min(30, workTargetMinutes - index * 30);
          const work = phase(
            'work',
            blockMinutes,
            index === 0 ? 'running' : 'suspended',
            firstGoal,
            todayPlanTask,
            now
          );
          return index === 0 ? [work] : [phase('short_break', 5, 'suspended'), work];
        }).flat()
      : [
          {
            ...phase('work', 30, 'running', firstGoal, todayPlanTask, now),
            runningSinceMs: now,
            startedAtMs: now,
          },
          phase('short_break', 5, 'suspended'),
          phase('work', 30, 'awaiting_goal'),
          phase('short_break', 5, 'suspended'),
          phase('work', 30, 'awaiting_goal'),
          phase('short_break', 5, 'suspended'),
          phase('work', 30, 'awaiting_goal'),
          phase('long_break', 30, 'suspended'),
        ],
  taskTarget:
    todayPlanTask && workTargetMinutes
      ? {
          ...todayPlanTask,
          goalSnapshot: firstGoal,
          estimatedMinutes: originalEstimateMinutes,
          workTargetMs: workTargetMinutes * minute,
          checkpointAtMs: null,
        }
      : null,
  startedAtMs: now,
  completedAtMs: null,
});

/** An extension starts at the click, never retroactively erasing overtime. */
export const extendTaskRun = (runtime: RuntimeDocument, minutes: number, now = Date.now()) => {
  const run = runtime.run;
  const target = taskTargetFor(run);
  const current = currentPhase(runtime);
  if (!target || !current || !target.checkpointAtMs || current.kind !== 'work') return false;
  const elapsed = workElapsed(run, now);
  if (elapsed + minutes * minute > 24 * 60 * minute) return false;
  if (current.state === 'running') {
    current.activeElapsedMs = phaseElapsed(current, now);
    current.runningSinceMs = now;
  }
  target.workTargetMs = elapsed + minutes * minute;
  target.checkpointAtMs = null;
  const first = run.kind === 'pomodoro' ? Math.min(minutes, 30) : minutes;
  current.plannedDurationMs = current.activeElapsedMs + first * minute;
  if (run.kind === 'pomodoro') {
    for (let remaining = minutes - first; remaining > 0; remaining -= 30) {
      run.phases.push(phase('short_break', 5, 'suspended'));
      run.phases.push(
        phase(
          'work',
          Math.min(30, remaining),
          'suspended',
          target.goalSnapshot,
          taskSourceSnapshot(target)
        )
      );
    }
  }
  return true;
};

export { currentPhase, freezePhase, resumePhase, completeRun, shouldAwaitFreshSystemCapture };
