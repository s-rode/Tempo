import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';
import { verifyToken } from './auth';
import {
  advanceRuntime,
  archiveFinishedRun,
  completeRun,
  createCustomRun,
  createPomodoroRun,
  currentPhase,
  freezePhase,
  getOrCreateRuntime,
  resumePhase,
  runtimeSnapshot,
  resumeFromStaleSystemSuspension,
  saveRuntime,
} from '../services/focusRuntime';
import { cancelPendingEnrichment } from '../services/categorization/enrichmentScheduler';
import { FocusRunHistoryModel } from '../models/focusRuntime';

const tokenInput = z.object({ token: z.string() });
const durations = z.union([
  z.literal(15),
  z.literal(30),
  z.literal(45),
  z.literal(60),
  z.literal(90),
  z.literal(120),
]);
const pauseDurations = z.union([
  z.literal(1),
  z.literal(5),
  z.literal(20),
  z.literal(30),
  z.literal(60),
  z.literal(120),
]);
const goal = z.string().trim().min(1).max(500);

const runtimeFor = async (token: string, heartbeat = true) => {
  const decoded = verifyToken(token);
  const runtime = await getOrCreateRuntime(decoded.userId);
  const now = Date.now();
  // On a fresh renderer after downtime, charge at most one sync window.
  // Active sessions sync every ten seconds; normal tracking does not poll.
  const lastHeartbeat = runtime.lastHeartbeatAtMs || now;
  advanceRuntime(runtime, Math.min(now, lastHeartbeat + 6_000));
  await archiveFinishedRun(runtime);
  if (heartbeat) runtime.lastHeartbeatAtMs = now;
  await saveRuntime(runtime);
  return runtime;
};

export const focusRuntimeRouter = router({
  getHistory: publicProcedure
    .input(tokenInput.extend({ startDateMs: z.number(), endDateMs: z.number() }))
    .query(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      return FocusRunHistoryModel.find({
        userId,
        endedAtMs: { $gte: input.startDateMs, $lt: input.endDateMs },
      })
        .sort({ endedAtMs: 1 })
        .lean();
    }),
  getState: publicProcedure.input(tokenInput).query(async ({ input }) => {
    const runtime = await runtimeFor(input.token);
    return runtimeSnapshot(runtime);
  }),

  // An explicit escape hatch for the rare case where macOS misses a wake or
  // unlock notification. It does not resume the phase itself; the next fresh
  // foreground capture performs that normal transition.
  resumeSystemSuspension: publicProcedure.input(tokenInput).mutation(async ({ input }) => {
    const userId = verifyToken(input.token).userId;
    cancelPendingEnrichment(userId);
    return resumeFromStaleSystemSuspension(userId);
  }),

  startCustom: publicProcedure
    .input(tokenInput.extend({ goal, durationMinutes: durations }))
    .mutation(async ({ input }) => {
      const runtime = await runtimeFor(input.token);
      cancelPendingEnrichment(verifyToken(input.token).userId);
      if (runtime.run?.state === 'active')
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Finish the current focus session first.',
        });
      runtime.run = createCustomRun(input.goal, input.durationMinutes);
      runtime.manualPauseUntilMs = null;
      runtime.manualPausedAtMs = null;
      await saveRuntime(runtime);
      return runtimeSnapshot(runtime);
    }),

  startPomodoro: publicProcedure
    .input(tokenInput.extend({ firstGoal: goal }))
    .mutation(async ({ input }) => {
      const runtime = await runtimeFor(input.token);
      cancelPendingEnrichment(verifyToken(input.token).userId);
      if (runtime.run?.state === 'active')
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Finish the current focus session first.',
        });
      runtime.run = createPomodoroRun(input.firstGoal);
      runtime.manualPauseUntilMs = null;
      runtime.manualPausedAtMs = null;
      await saveRuntime(runtime);
      return runtimeSnapshot(runtime);
    }),

  confirmWorkGoal: publicProcedure
    .input(tokenInput.extend({ goal }))
    .mutation(async ({ input }) => {
      const runtime = await runtimeFor(input.token);
      cancelPendingEnrichment(verifyToken(input.token).userId);
      const phase = currentPhase(runtime);
      if (
        runtime.run?.kind !== 'pomodoro' ||
        !phase ||
        phase.kind !== 'work' ||
        phase.state !== 'awaiting_goal'
      ) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Tempo is not waiting for a Pomodoro work goal.',
        });
      }
      phase.goal = input.goal;
      phase.state = 'running';
      phase.runningSinceMs = Date.now();
      phase.startedAtMs = phase.runningSinceMs;
      await saveRuntime(runtime);
      return runtimeSnapshot(runtime);
    }),

  pause: publicProcedure
    .input(tokenInput.extend({ durationMinutes: pauseDurations }))
    .mutation(async ({ input }) => {
      const runtime = await runtimeFor(input.token);
      cancelPendingEnrichment(verifyToken(input.token).userId);
      const now = Date.now();
      freezePhase(runtime, now);
      runtime.manualPauseUntilMs = now + input.durationMinutes * 60_000;
      runtime.manualPausedAtMs = now;
      await saveRuntime(runtime);
      return runtimeSnapshot(runtime, now);
    }),

  resume: publicProcedure.input(tokenInput).mutation(async ({ input }) => {
    const runtime = await runtimeFor(input.token);
    cancelPendingEnrichment(verifyToken(input.token).userId);
    runtime.manualPauseUntilMs = null;
    runtime.manualPausedAtMs = null;
    resumePhase(runtime, Date.now());
    await saveRuntime(runtime);
    return runtimeSnapshot(runtime);
  }),

  skipBreak: publicProcedure.input(tokenInput).mutation(async ({ input }) => {
    const runtime = await runtimeFor(input.token);
    cancelPendingEnrichment(verifyToken(input.token).userId);
    const phase = currentPhase(runtime);
    if (!runtime.run || !phase || (phase.kind !== 'short_break' && phase.kind !== 'long_break')) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Tempo is not currently on a scheduled break.',
      });
    }
    phase.state = 'completed';
    phase.runningSinceMs = null;
    if (phase.kind === 'long_break') completeRun(runtime, Date.now(), 'completed');
    else {
      runtime.run.currentPhaseIndex += 1;
      const next = currentPhase(runtime);
      if (next) {
        next.state = 'awaiting_goal';
        next.runningSinceMs = null;
      }
    }
    await saveRuntime(runtime);
    return runtimeSnapshot(runtime);
  }),

  endRun: publicProcedure.input(tokenInput).mutation(async ({ input }) => {
    const runtime = await runtimeFor(input.token);
    cancelPendingEnrichment(verifyToken(input.token).userId);
    if (runtime.run?.state === 'active') {
      completeRun(runtime, Date.now(), 'cancelled');
      await archiveFinishedRun(runtime);
    }
    runtime.manualPauseUntilMs = null;
    runtime.manualPausedAtMs = null;
    await saveRuntime(runtime);
    return runtimeSnapshot(runtime);
  }),
});
