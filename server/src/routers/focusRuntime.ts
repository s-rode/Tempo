import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';
import { verifyToken } from './auth';
import {
  advanceRuntime,
  acknowledgeTransitionNotice,
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
import { getCurrentDailyPlanTask } from '../services/goalPlans';

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
const goalSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('custom'), goal }),
  z.object({ kind: z.literal('today_plan_task'), taskId: z.string().uuid() }),
]);

const resolveGoalSource = async (
  userId: string,
  source: z.infer<typeof goalSource>
): Promise<{ goal: string; todayPlanTask: { taskId: string; dateKey: string } | null }> => {
  if (source.kind === 'custom') return { goal: source.goal, todayPlanTask: null };
  const plannedTask = await getCurrentDailyPlanTask(userId, source.taskId);
  if (!plannedTask) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'That task is no longer an unfinished item in Today’s Plan.',
    });
  }
  return {
    goal: plannedTask.task.text.trim(),
    todayPlanTask: { taskId: plannedTask.task.id, dateKey: plannedTask.dateKey },
  };
};

const runtimeFor = async (token: string, heartbeat = true) => {
  const decoded = verifyToken(token);
  const runtime = await getOrCreateRuntime(decoded.userId);
  const now = Date.now();
  // On a fresh renderer after downtime, charge at most one sync window.
  // Active sessions sync every ten seconds; normal tracking does not poll.
  const lastHeartbeat = runtime.lastHeartbeatAtMs || now;
  const rendererWasContinuouslyPresent = heartbeat && now - lastHeartbeat <= 12_000;
  // The scheduler owns ordinary boundaries. This is only a narrow recovery
  // path for a live renderer racing the same event-loop turn; a stale reload
  // can reconcile state but never manufactures an alert.
  advanceRuntime(runtime, Math.min(now, lastHeartbeat + 6_000), {
    emitTransitionNotice: rendererWasContinuouslyPresent,
  });
  await archiveFinishedRun(runtime);
  if (heartbeat) runtime.lastHeartbeatAtMs = now;
  await saveRuntime(runtime);
  return runtime;
};

export const focusRuntimeRouter = router({
  /**
   * Work-phase metadata for annotating a selected day's timeline. The client
   * still calculates focused and distracted time from classified activity,
   * rather than trusting a session timer as a proxy for adherence.
   */
  getTimelineRuns: publicProcedure
    .input(tokenInput.extend({ startDateMs: z.number(), endDateMs: z.number() }))
    .query(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      // A completed run is archived during reconciliation. Do that before the
      // history query so a just-finished focus phase appears immediately.
      const runtime = await runtimeFor(input.token, false);
      const history = await FocusRunHistoryModel.find({
        userId,
        'run.startedAtMs': { $lt: input.endDateMs },
        endedAtMs: { $gte: input.startDateMs },
      })
        .sort({ 'run.startedAtMs': 1 })
        .lean();

      const activeRun =
        runtime.run?.state === 'active' && runtime.run.startedAtMs < input.endDateMs
          ? runtime.run.toObject
            ? runtime.run.toObject()
            : runtime.run
          : null;

      return [
        ...history.map((entry) => ({
          run: entry.run,
          endedAtMs: entry.endedAtMs,
          outcome: entry.outcome,
        })),
        ...(activeRun ? [{ run: activeRun, endedAtMs: null, outcome: null }] : []),
      ];
    }),
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

  // Delivery acknowledgement is idempotent. It prevents a renderer reload or
  // helper restart from replaying a natural phase-completion alert.
  acknowledgeTransitionNotice: publicProcedure
    .input(tokenInput.extend({ noticeId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      return acknowledgeTransitionNotice(userId, input.noticeId);
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
    .input(tokenInput.extend({ goalSource, durationMinutes: durations }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const runtime = await runtimeFor(input.token);
      cancelPendingEnrichment(userId);
      if (runtime.run?.state === 'active')
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Finish the current focus session first.',
        });
      const resolvedGoal = await resolveGoalSource(userId, input.goalSource);
      runtime.run = createCustomRun(
        resolvedGoal.goal,
        input.durationMinutes,
        Date.now(),
        resolvedGoal.todayPlanTask
      );
      runtime.manualPauseUntilMs = null;
      runtime.manualPausedAtMs = null;
      await saveRuntime(runtime);
      return runtimeSnapshot(runtime);
    }),

  startPomodoro: publicProcedure
    .input(tokenInput.extend({ firstGoalSource: goalSource }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const runtime = await runtimeFor(input.token);
      cancelPendingEnrichment(userId);
      if (runtime.run?.state === 'active')
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Finish the current focus session first.',
        });
      const resolvedGoal = await resolveGoalSource(userId, input.firstGoalSource);
      runtime.run = createPomodoroRun(
        resolvedGoal.goal,
        Date.now(),
        resolvedGoal.todayPlanTask
      );
      runtime.manualPauseUntilMs = null;
      runtime.manualPausedAtMs = null;
      await saveRuntime(runtime);
      return runtimeSnapshot(runtime);
    }),

  confirmWorkGoal: publicProcedure
    .input(tokenInput.extend({ goalSource }))
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
      const resolvedGoal = await resolveGoalSource(verifyToken(input.token).userId, input.goalSource);
      phase.goal = resolvedGoal.goal;
      phase.todayPlanTask = resolvedGoal.todayPlanTask;
      phase.state = 'running';
      phase.runningSinceMs = Date.now();
      phase.startedAtMs = phase.runningSinceMs;
      phase.completedAtMs = null;
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
    phase.completedAtMs = Date.now();
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
