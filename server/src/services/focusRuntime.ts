import crypto from 'crypto';
import { FocusRunHistoryModel, FocusRuntimeModel } from '../models/focusRuntime';

export type SuspensionReason =
  | 'manual_pause'
  | 'pomodoro_break'
  | 'long_break'
  | 'awaiting_goal'
  | 'awaiting_system_resume'
  | 'screen_locked'
  | 'system_sleep';

type RuntimeDocument = any;

const minute = 60_000;
const phase = (
  kind: 'work' | 'short_break' | 'long_break',
  durationMinutes: number,
  state: string,
  goal: string | null = null
) => ({
  id: crypto.randomUUID(),
  kind,
  goal,
  startedAtMs: state === 'running' ? Date.now() : null,
  completedAtMs: null,
  plannedDurationMs: durationMinutes * minute,
  activeElapsedMs: 0,
  runningSinceMs: state === 'running' ? Date.now() : null,
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

const freezePhase = (runtime: RuntimeDocument, now: number) => {
  const current = currentPhase(runtime);
  if (!current || current.state !== 'running' || !current.runningSinceMs) return;
  current.activeElapsedMs = Math.min(
    current.plannedDurationMs,
    current.activeElapsedMs + Math.max(0, now - current.runningSinceMs)
  );
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

const advancePhase = (runtime: RuntimeDocument, now: number) => {
  const run = runtime.run;
  const current = currentPhase(runtime);
  if (!run || !current) return;
  current.activeElapsedMs = current.plannedDurationMs;
  current.runningSinceMs = null;
  current.state = 'completed';
  current.completedAtMs = now;

  if (run.kind === 'custom' || current.kind === 'long_break') {
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
    next.state = 'awaiting_goal';
    next.runningSinceMs = null;
    next.startedAtMs = null;
  } else {
    next.state = 'running';
    next.runningSinceMs = now;
    next.startedAtMs = now;
  }
};

/** Applies timer expiry using server time. It never charges time while suspended. */
export const advanceRuntime = (runtime: RuntimeDocument, now = Date.now()) => {
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
  const elapsed = current.activeElapsedMs + Math.max(0, now - current.runningSinceMs);
  if (elapsed < current.plannedDurationMs) return;
  advancePhase(runtime, now);
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
    ? Math.min(
        current.plannedDurationMs,
        current.activeElapsedMs +
          (current.state === 'running' && current.runningSinceMs
            ? Math.max(0, now - current.runningSinceMs)
            : 0)
      )
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
    revision: runtime.revision || 0,
  };
};

export async function saveRuntime(runtime: RuntimeDocument) {
  runtime.revision = (runtime.revision || 0) + 1;
  await runtime.save();
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
    runtime.awaitingSystemResumeCapture = true;
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
  runtime.awaitingSystemResumeCapture = true;
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

export const createCustomRun = (goal: string, durationMinutes: number, now = Date.now()) => ({
  id: crypto.randomUUID(),
  kind: 'custom',
  state: 'active',
  currentPhaseIndex: 0,
  phases: [
    { ...phase('work', durationMinutes, 'running', goal), runningSinceMs: now, startedAtMs: now },
  ],
  startedAtMs: now,
  completedAtMs: null,
});

export const createPomodoroRun = (firstGoal: string, now = Date.now()) => ({
  id: crypto.randomUUID(),
  kind: 'pomodoro',
  state: 'active',
  currentPhaseIndex: 0,
  phases: [
    { ...phase('work', 30, 'running', firstGoal), runningSinceMs: now, startedAtMs: now },
    phase('short_break', 5, 'suspended'),
    phase('work', 30, 'awaiting_goal'),
    phase('short_break', 5, 'suspended'),
    phase('work', 30, 'awaiting_goal'),
    phase('short_break', 5, 'suspended'),
    phase('work', 30, 'awaiting_goal'),
    phase('long_break', 30, 'suspended'),
  ],
  startedAtMs: now,
  completedAtMs: null,
});

export { currentPhase, freezePhase, resumePhase, completeRun };
