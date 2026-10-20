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
  extendTaskRun,
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
import { getCurrentDailyPlanTask, resolveEffectiveGoalContext } from '../services/goalPlans';
import { GoalPlanModel } from '../models/goalPlan';
import {
  cancelPendingGoalSupportProfiles,
  ensureGoalSupportProfiles,
} from '../services/categorization/goalSupportProfileScheduler';

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
const taskMinutes = z.number().int().min(1).max(720);
const goalSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('custom'), goal }),
  z.object({ kind: z.literal('today_plan_task'), taskId: z.string().uuid() }),
]);

const resolveGoalSource = async (
  userId: string,
  source: z.infer<typeof goalSource>
): Promise<{ goal: string; todayPlanTask: { taskId: string; dateKey: string } | null; estimatedMinutes: number | null }> => {
  if (source.kind === 'custom') return { goal: source.goal, todayPlanTask: null, estimatedMinutes: null };
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
    estimatedMinutes: plannedTask.task.estimatedMinutes ?? null,
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

const scheduleActiveGoalProfile = async (userId: string): Promise<void> => {
  ensureGoalSupportProfiles(userId, await resolveEffectiveGoalContext(userId));
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
    cancelPendingGoalSupportProfiles(userId);
    return resumeFromStaleSystemSuspension(userId);
  }),

  startCustom: publicProcedure
    .input(tokenInput.extend({ goalSource, durationMinutes: taskMinutes }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const runtime = await runtimeFor(input.token);
      cancelPendingEnrichment(userId);
      cancelPendingGoalSupportProfiles(userId);
      if (runtime.run?.state === 'active')
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Finish the current focus session first.',
        });
      const resolvedGoal = await resolveGoalSource(userId, input.goalSource);
      if (resolvedGoal.todayPlanTask && input.durationMinutes > 720)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Work time must be at most 12 hours.' });
      if (!resolvedGoal.todayPlanTask && !durations.safeParse(input.durationMinutes).success)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a standard focus duration.' });
      runtime.run = createCustomRun(
        resolvedGoal.goal,
        input.durationMinutes,
        Date.now(),
        resolvedGoal.todayPlanTask,
        resolvedGoal.estimatedMinutes
      );
      runtime.manualPauseUntilMs = null;
      runtime.manualPausedAtMs = null;
      await saveRuntime(runtime);
      await scheduleActiveGoalProfile(userId);
      return runtimeSnapshot(runtime);
    }),

  startPomodoro: publicProcedure
    .input(tokenInput.extend({ firstGoalSource: goalSource, workTargetMinutes: taskMinutes.optional() }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const runtime = await runtimeFor(input.token);
      cancelPendingEnrichment(userId);
      cancelPendingGoalSupportProfiles(userId);
      if (runtime.run?.state === 'active')
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Finish the current focus session first.',
        });
      const resolvedGoal = await resolveGoalSource(userId, input.firstGoalSource);
      runtime.run = createPomodoroRun(resolvedGoal.goal, Date.now(), resolvedGoal.todayPlanTask,
        resolvedGoal.todayPlanTask ? input.workTargetMinutes ?? resolvedGoal.estimatedMinutes ?? 120 : null,
        resolvedGoal.estimatedMinutes);
      runtime.manualPauseUntilMs = null;
      runtime.manualPausedAtMs = null;
      await saveRuntime(runtime);
      await scheduleActiveGoalProfile(userId);
      return runtimeSnapshot(runtime);
    }),

  confirmWorkGoal: publicProcedure
    .input(tokenInput.extend({ goalSource }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const runtime = await runtimeFor(input.token);
      cancelPendingEnrichment(userId);
      cancelPendingGoalSupportProfiles(userId);
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
      if (runtime.run.taskTarget?.taskId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Finish or end this planned task session before changing its goal.',
        });
      }
      const resolvedGoal = await resolveGoalSource(userId, input.goalSource);
      phase.goal = resolvedGoal.goal;
      phase.todayPlanTask = resolvedGoal.todayPlanTask;
      phase.goalHistory = [
        {
          goal: resolvedGoal.goal,
          todayPlanTask: resolvedGoal.todayPlanTask,
          startedAtMs: Date.now(),
        },
      ];
      phase.state = 'running';
      phase.runningSinceMs = Date.now();
      phase.startedAtMs = phase.runningSinceMs;
      phase.completedAtMs = null;
      await saveRuntime(runtime);
      await scheduleActiveGoalProfile(userId);
      return runtimeSnapshot(runtime);
    }),

  /**
   * Switches the goal for the current work phase without restarting its clock.
   * The phase keeps timestamped goal segments so finished work is not relabelled
   * in the timeline after the user moves to the next task.
   */
  changeCurrentWorkGoal: publicProcedure
    .input(tokenInput.extend({ goalSource }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const runtime = await runtimeFor(input.token);
      const phase = currentPhase(runtime);
      if (
        !runtime.run ||
        !phase ||
        phase.kind !== 'work' ||
        phase.state === 'awaiting_goal' ||
        phase.state === 'completed'
      ) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Tempo is not currently in a work phase.',
        });
      }

      if (runtime.run.taskTarget?.taskId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Finish or end this planned task session before changing its goal.',
        });
      }

      const resolvedGoal = await resolveGoalSource(userId, input.goalSource);
      const sameGoal =
        phase.goal === resolvedGoal.goal &&
        phase.todayPlanTask?.taskId === resolvedGoal.todayPlanTask?.taskId &&
        phase.todayPlanTask?.dateKey === resolvedGoal.todayPlanTask?.dateKey;
      if (!sameGoal) {
        const now = Date.now();
        const existingHistory = Array.isArray(phase.goalHistory) ? phase.goalHistory : [];
        // Older phases predate goalHistory. Recover their initial segment from
        // the immutable phase snapshot before adding the new boundary.
        if (!existingHistory.length && phase.goal?.trim() && phase.startedAtMs) {
          existingHistory.push({
            goal: phase.goal,
            todayPlanTask: phase.todayPlanTask || null,
            startedAtMs: phase.startedAtMs,
          });
        }
        existingHistory.push({
          goal: resolvedGoal.goal,
          todayPlanTask: resolvedGoal.todayPlanTask,
          startedAtMs: now,
        });
        phase.goalHistory = existingHistory;
        phase.goal = resolvedGoal.goal;
        phase.todayPlanTask = resolvedGoal.todayPlanTask;
      }

      cancelPendingEnrichment(userId);
      cancelPendingGoalSupportProfiles(userId);
      await saveRuntime(runtime);
      await scheduleActiveGoalProfile(userId);
      return runtimeSnapshot(runtime);
    }),

  pause: publicProcedure
    .input(tokenInput.extend({ durationMinutes: pauseDurations }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const runtime = await runtimeFor(input.token);
      cancelPendingEnrichment(userId);
      cancelPendingGoalSupportProfiles(userId);
      const now = Date.now();
      freezePhase(runtime, now);
      runtime.manualPauseUntilMs = now + input.durationMinutes * 60_000;
      runtime.manualPausedAtMs = now;
      await saveRuntime(runtime);
      return runtimeSnapshot(runtime, now);
    }),

  resume: publicProcedure.input(tokenInput).mutation(async ({ input }) => {
    const userId = verifyToken(input.token).userId;
    const runtime = await runtimeFor(input.token);
    cancelPendingEnrichment(userId);
    cancelPendingGoalSupportProfiles(userId);
    runtime.manualPauseUntilMs = null;
    runtime.manualPausedAtMs = null;
    resumePhase(runtime, Date.now());
    await saveRuntime(runtime);
    await scheduleActiveGoalProfile(userId);
    return runtimeSnapshot(runtime);
  }),

  skipBreak: publicProcedure.input(tokenInput).mutation(async ({ input }) => {
    const userId = verifyToken(input.token).userId;
    const runtime = await runtimeFor(input.token);
    cancelPendingEnrichment(userId);
    cancelPendingGoalSupportProfiles(userId);
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
        if (runtime.run.taskTarget?.taskId) {
          next.state = 'running';
          next.runningSinceMs = Date.now();
          next.startedAtMs = next.runningSinceMs;
          next.goalHistory = [{ goal: runtime.run.taskTarget.goalSnapshot,
            todayPlanTask: { taskId: runtime.run.taskTarget.taskId, dateKey: runtime.run.taskTarget.dateKey },
            startedAtMs: next.startedAtMs }];
        } else {
          next.state = 'awaiting_goal';
          next.runningSinceMs = null;
        }
      }
    }
    await saveRuntime(runtime);
    return runtimeSnapshot(runtime);
  }),

  endRun: publicProcedure.input(tokenInput).mutation(async ({ input }) => {
    const userId = verifyToken(input.token).userId;
    const runtime = await runtimeFor(input.token);
    cancelPendingEnrichment(userId);
    cancelPendingGoalSupportProfiles(userId);
    if (runtime.run?.state === 'active') {
      if (runtime.transitionNotice?.kind === 'task_target_reached')
        runtime.acknowledgedTransitionNoticeId = runtime.transitionNotice.id;
      completeRun(runtime, Date.now(), 'cancelled');
      await archiveFinishedRun(runtime);
    }
    runtime.manualPauseUntilMs = null;
    runtime.manualPausedAtMs = null;
    await saveRuntime(runtime);
    return runtimeSnapshot(runtime);
  }),
  finishTaskSession: publicProcedure.input(tokenInput.extend({ runId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const runtime = await runtimeFor(input.token);
      const run = runtime.run;
      let taskSource: { taskId: string; dateKey: string } | null = null;
      if (run?.id === input.runId && run.state === 'active' && run.taskTarget?.taskId) {
        taskSource = { taskId: run.taskTarget.taskId, dateKey: run.taskTarget.dateKey };
        if (runtime.transitionNotice?.kind === 'task_target_reached')
          runtime.acknowledgedTransitionNoticeId = runtime.transitionNotice.id;
        completeRun(runtime, Date.now(), 'completed');
        await archiveFinishedRun(runtime);
        runtime.manualPauseUntilMs = null;
        runtime.manualPausedAtMs = null;
        await saveRuntime(runtime);
      } else {
        // A retry after archiving may still need to complete the plan task if
        // the process stopped between the two local writes.
        const archived = await FocusRunHistoryModel.findOne({ userId, runId: input.runId, outcome: 'completed' }).lean();
        if (archived?.run?.taskTarget?.taskId)
          taskSource = { taskId: archived.run.taskTarget.taskId, dateKey: archived.run.taskTarget.dateKey };
      }
      if (!taskSource)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'That planned task session is no longer active.' });
      // Historical day key is intentional: a session can cross midnight.
      await GoalPlanModel.updateOne(
        { userId, scope: 'daily', periodKey: taskSource.dateKey,
          tasks: { $elemMatch: { id: taskSource.taskId, completedAtMs: null } } },
        { $set: { 'tasks.$.completedAtMs': Date.now() } }
      );
      cancelPendingEnrichment(userId);
      cancelPendingGoalSupportProfiles(userId);
      await scheduleActiveGoalProfile(userId);
      return runtimeSnapshot(runtime);
    }),
  extendTaskSession: publicProcedure.input(tokenInput.extend({ runId: z.string().uuid(), minutes: taskMinutes }))
    .mutation(async ({ input }) => {
      const runtime = await runtimeFor(input.token);
      if (runtime.run?.id !== input.runId || !extendTaskRun(runtime, input.minutes))
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This session cannot be extended, or it would exceed 24 hours of work.' });
      if (runtime.transitionNotice?.kind === 'task_target_reached')
        runtime.acknowledgedTransitionNoticeId = runtime.transitionNotice.id;
      await saveRuntime(runtime);
      return runtimeSnapshot(runtime);
    }),
});
