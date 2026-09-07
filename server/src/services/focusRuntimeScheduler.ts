import { FocusRuntimeModel } from '../models/focusRuntime';
import { advanceRuntime, archiveFinishedRun, currentPhase, saveRuntime } from './focusRuntime';

/**
 * One server-owned timer per active Tempo runtime. The renderer remains a
 * presentation client: it may refresh the snapshot, but it is never required
 * to be alive for a phase boundary to advance.
 */
const scheduledDeadlines = new Map<string, ReturnType<typeof setTimeout>>();
const runningUsers = new Set<string>();

const clearDeadline = (userId: string) => {
  const timer = scheduledDeadlines.get(userId);
  if (timer) clearTimeout(timer);
  scheduledDeadlines.delete(userId);
};

const deadlineFor = (runtime: any): number | null => {
  if (runtime.systemLocked || runtime.systemSleeping || runtime.awaitingSystemResumeCapture)
    return null;
  if (runtime.manualPauseUntilMs) return runtime.manualPauseUntilMs;
  const phase = currentPhase(runtime);
  if (!phase || phase.state !== 'running' || !phase.runningSinceMs) return null;
  return phase.runningSinceMs + Math.max(0, phase.plannedDurationMs - phase.activeElapsedMs);
};

async function deliverDeadline(userId: string): Promise<void> {
  if (runningUsers.has(userId)) return;
  runningUsers.add(userId);
  try {
    const runtime = await FocusRuntimeModel.findOne({ userId });
    if (!runtime) return;
    const deadline = deadlineFor(runtime);
    const now = Date.now();
    if (!deadline || now + 2 < deadline) return;

    // Only this path creates an alertable notice. Reconciliation after app or
    // server downtime uses the normal, silent advance path below.
    advanceRuntime(runtime, now, { emitTransitionNotice: true });
    await archiveFinishedRun(runtime);
    await saveRuntime(runtime, { rearmScheduler: false });
  } finally {
    runningUsers.delete(userId);
    await armFocusRuntimeDeadline(userId);
  }
}

/** Replaces the timer after every persisted runtime mutation. */
export async function armFocusRuntimeDeadline(userId: string): Promise<void> {
  clearDeadline(userId);
  const runtime = await FocusRuntimeModel.findOne({ userId });
  if (!runtime) return;
  const deadline = deadlineFor(runtime);
  if (!deadline) return;
  const delay = Math.max(1, deadline - Date.now());
  scheduledDeadlines.set(
    userId,
    setTimeout(() => {
      scheduledDeadlines.delete(userId);
      void deliverDeadline(userId);
    }, delay)
  );
}

/**
 * A server restart must leave the runtime coherent, but must not manufacture a
 * stale completion alert for time the user never observed Tempo running.
 */
export async function initializeFocusRuntimeScheduler(): Promise<void> {
  const runtimes = await FocusRuntimeModel.find({ 'run.state': 'active' });
  const now = Date.now();
  for (const runtime of runtimes) {
    const deadline = deadlineFor(runtime);
    if (deadline && deadline <= now) {
      advanceRuntime(runtime, now);
      await archiveFinishedRun(runtime);
      await saveRuntime(runtime, { rearmScheduler: false });
    }
    await armFocusRuntimeDeadline(String(runtime.userId));
  }
}
