import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { GoalPlanModel, GoalTask } from '../models/goalPlan';
import { getReminderIntegration } from '../services/reminders';
import {
  DailyPlanSnapshot,
  fingerprintClassificationContext,
  fingerprintEffectiveGoalContext,
  getCurrentPlanning,
  getDailyPlan,
  goalPeriodFor,
  localTimeZone,
  resolveEffectiveGoalContext,
} from '../services/goalPlans';
import { cancelPendingEnrichment } from '../services/categorization/enrichmentScheduler';
import {
  cancelPendingGoalSupportProfiles,
  ensureGoalSupportProfiles,
} from '../services/categorization/goalSupportProfileScheduler';
import { publicProcedure, router } from '../trpc';
import { verifyToken } from './auth';

const tokenInput = z.object({ token: z.string() });
const taskText = z.string().trim().min(1).max(500);
const estimatedMinutes = z.number().int().min(1).max(720).nullable();
const persistedTask = z.object({
  id: z.string().uuid(),
  text: taskText,
  estimatedMinutes: estimatedMinutes.optional(),
  position: z.number().int().min(0).max(99),
  completedAtMs: z.number().nullable(),
});

const changed = async (userId: string, beforeFingerprint: string) => {
  cancelPendingEnrichment(userId);
  const context = await resolveEffectiveGoalContext(userId);
  ensureGoalSupportProfiles(userId, context);
  return {
    context,
    effectiveContextChanged: fingerprintEffectiveGoalContext(context) !== beforeFingerprint,
    classificationContextFingerprint: fingerprintClassificationContext(context),
    profilePending: Boolean(context.targets?.some((target) => !target.supportProfile)),
  };
};

// Stop a queued rich-copy request before a mutation changes the context it was
// built around. `changed` repeats the cancellation after persistence to cover
// the tiny interval in which a new capture could arrive.
const prepareGoalMutation = async (userId: string): Promise<string> => {
  cancelPendingEnrichment(userId);
  cancelPendingGoalSupportProfiles(userId);
  return fingerprintEffectiveGoalContext(await resolveEffectiveGoalContext(userId));
};

const requireCurrentDaily = async (userId: string) => {
  if ((await getReminderIntegration(userId))?.enabled) throw new TRPCError({
    code: 'PRECONDITION_FAILED', message: 'Edit your tasks in Reminders, or disconnect Reminders to use manual Tempo tasks.',
  });
  const periodKey = goalPeriodFor.dayKey();
  const plan = await GoalPlanModel.findOne({ userId, scope: 'daily', periodKey });
  if (!plan) {
    return GoalPlanModel.create({
      userId,
      scope: 'daily',
      periodKey,
      timeZone: localTimeZone(),
      tasks: [],
      text: '',
    });
  }
  return plan;
};

const publicDaily = (snapshot: DailyPlanSnapshot) => snapshot;

export const goalsRouter = router({
  getDailyPlan: publicProcedure
    .input(tokenInput.extend({ dateMs: z.number().optional() }))
    .query(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      return publicDaily(await getDailyPlan(userId, input.dateMs));
    }),
  getPlanning: publicProcedure.input(tokenInput).query(async ({ input }) => {
    const userId = verifyToken(input.token).userId;
    return getCurrentPlanning(userId);
  }),
  getActiveContext: publicProcedure.input(tokenInput).query(async ({ input }) => {
    const userId = verifyToken(input.token).userId;
    const context = await resolveEffectiveGoalContext(userId);
    return {
      ...context,
      classificationContextFingerprint: fingerprintClassificationContext(context),
      profilePending: Boolean(context.targets?.some((target) => !target.supportProfile)),
    };
  }),
  addDailyTask: publicProcedure
    .input(tokenInput.extend({ text: taskText, estimatedMinutes: estimatedMinutes.optional() }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const before = await prepareGoalMutation(userId);
      const plan = await requireCurrentDaily(userId);
      const tasks = (plan.tasks || []) as GoalTask[];
      const task: GoalTask = {
        id: randomUUID(),
        text: input.text,
        estimatedMinutes: input.estimatedMinutes ?? null,
        position: tasks.filter((task) => task.completedAtMs === null).length,
        completedAtMs: null,
      };
      tasks.push(task);
      plan.tasks = tasks as any;
      await plan.save();
      return { ...(await changed(userId, before)), task, plan: await getDailyPlan(userId) };
    }),
  updateDailyTask: publicProcedure
    .input(tokenInput.extend({ taskId: z.string().uuid(), text: taskText, estimatedMinutes: estimatedMinutes.optional() }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const before = await prepareGoalMutation(userId);
      const plan = await requireCurrentDaily(userId);
      const task = ((plan.tasks || []) as GoalTask[]).find((entry) => entry.id === input.taskId);
      if (!task)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That task is no longer available.' });
      task.text = input.text;
      if (input.estimatedMinutes !== undefined) task.estimatedMinutes = input.estimatedMinutes;
      plan.markModified('tasks');
      await plan.save();
      return { ...(await changed(userId, before)), plan: await getDailyPlan(userId) };
    }),
  setDailyTaskCompleted: publicProcedure
    .input(tokenInput.extend({ taskId: z.string().uuid(), completed: z.boolean() }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const before = await prepareGoalMutation(userId);
      const plan = await requireCurrentDaily(userId);
      const task = ((plan.tasks || []) as GoalTask[]).find((entry) => entry.id === input.taskId);
      if (!task)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That task is no longer available.' });
      task.completedAtMs = input.completed ? Date.now() : null;
      plan.markModified('tasks');
      await plan.save();
      return { ...(await changed(userId, before)), plan: await getDailyPlan(userId) };
    }),
  reorderDailyTasks: publicProcedure
    .input(tokenInput.extend({ taskIds: z.array(z.string().uuid()).max(100) }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const before = await prepareGoalMutation(userId);
      const plan = await requireCurrentDaily(userId);
      const tasks = (plan.tasks || []) as GoalTask[];
      const active = tasks.filter((task) => task.completedAtMs === null);
      if (
        active.length !== input.taskIds.length ||
        new Set(input.taskIds).size !== input.taskIds.length ||
        active.some((task) => !input.taskIds.includes(task.id))
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The task order is stale. Refresh and try again.',
        });
      }
      const byId = new Map(active.map((task) => [task.id, task]));
      input.taskIds.forEach((taskId, position) => {
        const task = byId.get(taskId);
        if (task) task.position = position;
      });
      plan.markModified('tasks');
      await plan.save();
      return { ...(await changed(userId, before)), plan: await getDailyPlan(userId) };
    }),
  deleteDailyTask: publicProcedure
    .input(tokenInput.extend({ taskId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const before = await prepareGoalMutation(userId);
      const plan = await requireCurrentDaily(userId);
      const tasks = (plan.tasks || []) as GoalTask[];
      const deletedTask = tasks.find((task) => task.id === input.taskId);
      if (!deletedTask)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That task is no longer available.' });
      plan.tasks = tasks.filter((task) => task.id !== input.taskId) as any;
      await plan.save();
      return { ...(await changed(userId, before)), deletedTask, plan: await getDailyPlan(userId) };
    }),
  restoreDailyTask: publicProcedure
    .input(tokenInput.extend({ task: persistedTask }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const before = await prepareGoalMutation(userId);
      const plan = await requireCurrentDaily(userId);
      const tasks = (plan.tasks || []) as GoalTask[];
      if (tasks.some((task) => task.id === input.task.id))
        throw new TRPCError({ code: 'CONFLICT', message: 'That task has already been restored.' });
      const restored: GoalTask = { ...input.task };
      if (restored.completedAtMs === null) {
        const active = tasks.filter((task) => task.completedAtMs === null);
        const position = Math.min(restored.position, active.length);
        active.forEach((task) => {
          if (task.position >= position) task.position += 1;
        });
        restored.position = position;
      }
      tasks.push(restored);
      plan.tasks = tasks as any;
      await plan.save();
      return {
        ...(await changed(userId, before)),
        task: restored,
        plan: await getDailyPlan(userId),
      };
    }),
  copyUnfinishedToToday: publicProcedure
    .input(tokenInput.extend({ sourceDateMs: z.number() }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const source = await getDailyPlan(userId, input.sourceDateMs);
      if (source.isToday)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'These tasks are already in today’s plan.',
        });
      const unfinished = source.tasks.filter((task) => task.completedAtMs === null);
      const before = await prepareGoalMutation(userId);
      const plan = await requireCurrentDaily(userId);
      const tasks = (plan.tasks || []) as GoalTask[];
      let position = tasks.filter((task) => task.completedAtMs === null).length;
      for (const task of unfinished)
        tasks.push({
          id: randomUUID(),
          text: task.text,
          estimatedMinutes: task.estimatedMinutes ?? null,
          position: position++,
          completedAtMs: null,
        });
      plan.tasks = tasks as any;
      await plan.save();
      return {
        ...(await changed(userId, before)),
        copied: unfinished.length,
        plan: await getDailyPlan(userId),
      };
    }),
  setWeeklyFocus: publicProcedure
    .input(
      tokenInput.extend({
        focusText: z.string().trim().max(1000),
        attentionGuardrail: z.string().trim().max(1000).optional().default(''),
      })
    )
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const before = await prepareGoalMutation(userId);
      await GoalPlanModel.findOneAndUpdate(
        { userId, scope: 'weekly', periodKey: goalPeriodFor.weekKey() },
        {
          $set: {
            userId,
            scope: 'weekly',
            periodKey: goalPeriodFor.weekKey(),
            timeZone: localTimeZone(),
            // Retain text for older local builds that may still read it, but
            // use the split values for every current classification path.
            text: input.focusText,
            focusText: input.focusText,
            attentionGuardrail: input.attentionGuardrail,
            focusReviewPending: false,
            tasks: [],
          },
        },
        { upsert: true, new: true }
      );
      return { ...(await changed(userId, before)), planning: await getCurrentPlanning(userId) };
    }),
  setLongTermDirection: publicProcedure
    .input(tokenInput.extend({ text: z.string().trim().max(1000) }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const before = await prepareGoalMutation(userId);
      await GoalPlanModel.findOneAndUpdate(
        { userId, scope: 'direction', periodKey: 'current' },
        {
          $set: {
            userId,
            scope: 'direction',
            periodKey: 'current',
            timeZone: localTimeZone(),
            text: input.text,
            tasks: [],
          },
        },
        { upsert: true, new: true }
      );
      return { ...(await changed(userId, before)), planning: await getCurrentPlanning(userId) };
    }),
});
