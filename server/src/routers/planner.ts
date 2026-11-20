import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { GoalPlanModel, GoalTask } from '../models/goalPlan';
import { PlannerGoalModel } from '../models/plannerGoal';
import { User as UserModel } from '../models/user';
import { localTimeZone } from '../services/goalPlans';
import {
  forgetRollover,
  forgetPlannerState,
  getPlannerState,
  rollOverUnfinished,
  serializePlanner,
} from '../services/plannerState';
import {
  PLANNER_GOAL_COLORS,
  doneTasks,
  insertOpenTask,
  isDateKey,
  keyFromDate,
  normalizeTasks,
  openTasks,
  removeTask,
  weekDayKeys,
  weekStartOf,
} from '../services/plannerTasks';
import { getReminderIntegration } from '../services/reminders';
import { publicProcedure, router } from '../trpc';
import { verifyToken } from './auth';
import { changed, prepareGoalMutation } from './goals';

const tokenInput = z.object({ token: z.string() });
const dateKey = z.string().refine(isDateKey, 'Expected a calendar day as YYYY-MM-DD.');
const taskText = z.string().trim().min(1).max(500);
const estimatedMinutes = z.number().int().min(1).max(720).nullable();
const goalId = z.string().uuid().nullable();
const goalFields = {
  title: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000),
  color: z.enum(PLANNER_GOAL_COLORS),
  icon: z.string().trim().max(16),
  weeklyTargetMinutes: z.number().int().min(15).max(6000).nullable(),
};

const today = (): string => keyFromDate(new Date());

const requirePlanner = async (userId: string): Promise<void> => {
  if (!(await getPlannerState(userId)).enabled)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Turn on Tempo’s planner in Settings to plan tasks here.',
    });
};

const tasksOn = async (userId: string, day: string): Promise<GoalTask[]> => {
  const plan = (await GoalPlanModel.findOne({ userId, scope: 'daily', periodKey: day }).lean()) as {
    tasks?: GoalTask[];
  } | null;
  return (plan?.tasks || []) as GoalTask[];
};

const saveTasks = (userId: string, day: string, tasks: GoalTask[]) =>
  GoalPlanModel.updateOne(
    { userId, scope: 'daily', periodKey: day },
    { $set: { tasks }, $setOnInsert: { timeZone: localTimeZone(), text: '' } },
    { upsert: true }
  );

const knownGoalId = async (userId: string, id: string | null | undefined) => {
  if (!id) return null;
  if (!(await PlannerGoalModel.exists({ userId, id })))
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That goal no longer exists.' });
  return id;
};

const missingTask = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'That task is no longer on this day.' });

const publicGoal = (goal: any) => ({
  id: goal.id as string,
  title: goal.title as string,
  notes: (goal.notes || '') as string,
  color: goal.color as string,
  icon: (goal.icon || '') as string,
  position: goal.position as number,
  completedAtMs: (goal.completedAtMs ?? null) as number | null,
  weeklyTargetMinutes: (goal.weeklyTargetMinutes ?? null) as number | null,
});

const listGoals = async (userId: string) => {
  const [goals, plans] = await Promise.all([
    PlannerGoalModel.find({ userId }).sort({ position: 1 }).lean(),
    GoalPlanModel.find({ userId, scope: 'daily', 'tasks.goalId': { $type: 'string' } })
      .select('tasks.goalId tasks.completedAtMs')
      .lean(),
  ]);
  const counts = new Map<string, { open: number; done: number }>();
  for (const plan of plans)
    for (const task of (plan.tasks || []) as GoalTask[]) {
      if (!task.goalId) continue;
      const count = counts.get(task.goalId) || { open: 0, done: 0 };
      if (task.completedAtMs === null) count.open += 1;
      else count.done += 1;
      counts.set(task.goalId, count);
    }
  return goals.map((goal) => ({
    ...publicGoal(goal),
    openTasks: counts.get(goal.id)?.open || 0,
    doneTasks: counts.get(goal.id)?.done || 0,
  }));
};

const weekFor = async (userId: string, weekStartKey: string) => {
  await rollOverUnfinished(userId);
  const keys = weekDayKeys(weekStartKey);
  const plans = (await GoalPlanModel.find({
    userId,
    scope: 'daily',
    periodKey: { $in: keys },
  }).lean()) as Array<{ periodKey: string; tasks?: GoalTask[] }>;
  const byDay = new Map(plans.map((plan) => [plan.periodKey, (plan.tasks || []) as GoalTask[]]));
  return {
    weekStartKey,
    todayKey: today(),
    days: keys.map((key) => ({
      dateKey: key,
      open: openTasks(byDay.get(key) || []),
      done: doneTasks(byDay.get(key) || []),
    })),
  };
};

/** Runs one planner change with the classification bookkeeping every plan edit needs. */
const mutate = async <T>(userId: string, work: () => Promise<T>) => {
  await requirePlanner(userId);
  const before = await prepareGoalMutation(userId);
  const result = await serializePlanner(userId, work);
  return { ...(await changed(userId, before)), result };
};

export const plannerRouter = router({
  getSource: publicProcedure.input(tokenInput).query(async ({ input }) => {
    const userId = verifyToken(input.token).userId;
    const [state, reminders] = await Promise.all([
      getPlannerState(userId),
      getReminderIntegration(userId),
    ]);
    return {
      source: state.enabled ? ('planner' as const) : ('reminders' as const),
      remindersConnected: Boolean(reminders?.enabled),
    };
  }),

  setSource: publicProcedure
    .input(tokenInput.extend({ source: z.enum(['reminders', 'planner']) }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const before = await prepareGoalMutation(userId);
      const state = await getPlannerState(userId);
      await UserModel.findByIdAndUpdate(userId, {
        $set: {
          'electronAppSettings.planningSource': input.source,
          // Each time the planner is switched on, carry-over starts fresh from
          // that day; tasks left over from an earlier period stay where they are.
          ...(input.source === 'planner' && !state.enabled
            ? { 'electronAppSettings.plannerSinceDateKey': today() }
            : {}),
        },
      });
      forgetPlannerState(userId);
      forgetRollover(userId);
      return { ...(await changed(userId, before)), source: input.source };
    }),

  getGoals: publicProcedure.input(tokenInput).query(async ({ input }) => {
    return listGoals(verifyToken(input.token).userId);
  }),

  createGoal: publicProcedure
    .input(
      tokenInput.extend({
        title: goalFields.title,
        notes: goalFields.notes.optional().default(''),
        color: goalFields.color,
        icon: goalFields.icon.optional().default(''),
        weeklyTargetMinutes: goalFields.weeklyTargetMinutes.optional().default(null),
      })
    )
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      await requirePlanner(userId);
      const last = await PlannerGoalModel.findOne({ userId }).sort({ position: -1 }).lean();
      const goal = await PlannerGoalModel.create({
        userId,
        id: randomUUID(),
        title: input.title,
        notes: input.notes,
        color: input.color,
        icon: input.icon,
        weeklyTargetMinutes: input.weeklyTargetMinutes,
        position: last ? last.position + 1 : 0,
        completedAtMs: null,
      });
      return publicGoal(goal);
    }),

  updateGoal: publicProcedure
    .input(
      tokenInput.extend({
        goalId: z.string().uuid(),
        title: goalFields.title.optional(),
        notes: goalFields.notes.optional(),
        color: goalFields.color.optional(),
        icon: goalFields.icon.optional(),
        weeklyTargetMinutes: goalFields.weeklyTargetMinutes.optional(),
        completed: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      await requirePlanner(userId);
      const { token: _token, goalId: id, completed, ...fields } = input;
      const updates: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(fields))
        if (value !== undefined) updates[name] = value;
      if (completed !== undefined) updates.completedAtMs = completed ? Date.now() : null;
      const goal = await PlannerGoalModel.findOneAndUpdate(
        { userId, id },
        { $set: updates },
        { new: true }
      ).lean();
      if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'That goal no longer exists.' });
      return publicGoal(goal);
    }),

  reorderGoals: publicProcedure
    .input(tokenInput.extend({ goalIds: z.array(z.string().uuid()).max(200) }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      await requirePlanner(userId);
      await Promise.all(
        input.goalIds.map((id, position) =>
          PlannerGoalModel.updateOne({ userId, id }, { $set: { position } })
        )
      );
      return listGoals(userId);
    }),

  /** Tasks keep their place in the plan; only the link to the goal is cleared. */
  deleteGoal: publicProcedure
    .input(tokenInput.extend({ goalId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      await requirePlanner(userId);
      await serializePlanner(userId, async () => {
        await GoalPlanModel.updateMany(
          { userId, scope: 'daily', 'tasks.goalId': input.goalId },
          { $set: { 'tasks.$[linked].goalId': null } },
          { arrayFilters: [{ 'linked.goalId': input.goalId }] }
        );
        await PlannerGoalModel.deleteOne({ userId, id: input.goalId });
      });
      return listGoals(userId);
    }),

  getWeek: publicProcedure
    .input(tokenInput.extend({ weekStartKey: dateKey.optional() }))
    .query(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      return weekFor(userId, weekStartOf(input.weekStartKey || today()));
    }),

  addTask: publicProcedure
    .input(
      tokenInput.extend({
        dateKey,
        text: taskText,
        goalId: goalId.optional(),
        estimatedMinutes: estimatedMinutes.optional(),
      })
    )
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      if (input.dateKey < today())
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Plan new tasks for today or a later day.',
        });
      const linkedGoal = await knownGoalId(userId, input.goalId);
      return mutate(userId, async () => {
        const tasks = await tasksOn(userId, input.dateKey);
        const task: GoalTask = {
          id: randomUUID(),
          text: input.text,
          estimatedMinutes: input.estimatedMinutes ?? null,
          position: openTasks(tasks).length,
          completedAtMs: null,
          goalId: linkedGoal,
          carriedFromDateKey: null,
        };
        await saveTasks(userId, input.dateKey, normalizeTasks([...tasks, task]));
        return task;
      });
    }),

  updateTask: publicProcedure
    .input(
      tokenInput.extend({
        dateKey,
        taskId: z.string().uuid(),
        text: taskText.optional(),
        goalId: goalId.optional(),
        estimatedMinutes: estimatedMinutes.optional(),
      })
    )
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const linkedGoal =
        input.goalId === undefined ? undefined : await knownGoalId(userId, input.goalId);
      return mutate(userId, async () => {
        const tasks = await tasksOn(userId, input.dateKey);
        const task = tasks.find((entry) => entry.id === input.taskId);
        if (!task) throw missingTask();
        if (input.text !== undefined) task.text = input.text;
        if (linkedGoal !== undefined) task.goalId = linkedGoal;
        if (input.estimatedMinutes !== undefined) task.estimatedMinutes = input.estimatedMinutes;
        await saveTasks(userId, input.dateKey, tasks);
        return task;
      });
    }),

  /** Reorders a task inside one day's queue or moves it to another day. */
  moveTask: publicProcedure
    .input(
      tokenInput.extend({
        taskId: z.string().uuid(),
        fromDateKey: dateKey,
        toDateKey: dateKey,
        toIndex: z.number().int().min(0).max(500),
      })
    )
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      if (input.toDateKey < today() && input.toDateKey !== input.fromDateKey)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Tasks can move to today or a later day.',
        });
      return mutate(userId, async () => {
        const source = await tasksOn(userId, input.fromDateKey);
        const task = source.find((entry) => entry.id === input.taskId);
        if (!task) throw missingTask();
        if (input.fromDateKey === input.toDateKey) {
          if (task.completedAtMs !== null) return task;
          await saveTasks(userId, input.toDateKey, insertOpenTask(source, task, input.toIndex));
          return task;
        }
        const moved: GoalTask = { ...task, carriedFromDateKey: null };
        // Write the destination first so an interrupted move never loses a task.
        await saveTasks(
          userId,
          input.toDateKey,
          insertOpenTask(await tasksOn(userId, input.toDateKey), moved, input.toIndex)
        );
        await saveTasks(userId, input.fromDateKey, removeTask(source, task.id));
        return moved;
      });
    }),

  setTaskCompleted: publicProcedure
    .input(tokenInput.extend({ dateKey, taskId: z.string().uuid(), completed: z.boolean() }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const outcome = await mutate(userId, async () => {
        const tasks = await tasksOn(userId, input.dateKey);
        const task = tasks.find((entry) => entry.id === input.taskId);
        if (!task) throw missingTask();
        if (input.completed) task.completedAtMs = task.completedAtMs ?? Date.now();
        else if (task.completedAtMs !== null) {
          task.completedAtMs = null;
          task.position = openTasks(tasks).length;
        }
        await saveTasks(userId, input.dateKey, normalizeTasks(tasks));
        return task;
      });
      // Reopening a task on an earlier day makes it unfinished work again,
      // which belongs in today's queue.
      if (!input.completed && input.dateKey < today()) {
        forgetRollover(userId);
        await rollOverUnfinished(userId);
      }
      return outcome;
    }),

  deleteTask: publicProcedure
    .input(tokenInput.extend({ dateKey, taskId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      return mutate(userId, async () => {
        const tasks = await tasksOn(userId, input.dateKey);
        const task = tasks.find((entry) => entry.id === input.taskId);
        if (!task) throw missingTask();
        await saveTasks(userId, input.dateKey, removeTask(tasks, task.id));
        return task;
      });
    }),

  /** Puts a deleted task back where it was; used by Undo. */
  restoreTask: publicProcedure
    .input(
      tokenInput.extend({
        dateKey,
        task: z.object({
          id: z.string().uuid(),
          text: taskText,
          estimatedMinutes: estimatedMinutes.optional(),
          position: z.number().int().min(0).max(500),
          completedAtMs: z.number().nullable(),
          goalId: goalId.optional(),
          carriedFromDateKey: dateKey.nullable().optional(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      return mutate(userId, async () => {
        const tasks = await tasksOn(userId, input.dateKey);
        if (tasks.some((entry) => entry.id === input.task.id)) return input.task;
        const goalStillExists =
          input.task.goalId && (await PlannerGoalModel.exists({ userId, id: input.task.goalId }));
        const task: GoalTask = {
          ...input.task,
          estimatedMinutes: input.task.estimatedMinutes ?? null,
          goalId: goalStillExists ? input.task.goalId : null,
        };
        await saveTasks(
          userId,
          input.dateKey,
          task.completedAtMs === null
            ? insertOpenTask(tasks, task, task.position)
            : normalizeTasks([...tasks, task])
        );
        return task;
      });
    }),
});
