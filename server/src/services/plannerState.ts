import { GoalPlanModel, GoalTask } from '../models/goalPlan';
import { User as UserModel } from '../models/user';
import { carryOver, keyFromDate, normalizeTasks } from './plannerTasks';

export type PlanningSource = 'reminders' | 'planner';

const todayKey = (now = Date.now()): string => keyFromDate(new Date(now));
const zone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

type PlannerState = { enabled: boolean; sinceDateKey: string | null };

// Every classification asks whether the planner is on. The answer changes only
// through `planner.setSource`, which calls `forgetPlannerState`, so it is cached.
const stateCache = new Map<string, PlannerState>();

export const forgetPlannerState = (userId: string): void => {
  stateCache.delete(userId);
};

export async function getPlannerState(userId: string): Promise<PlannerState> {
  const cached = stateCache.get(userId);
  if (cached) return cached;
  const state = await readPlannerState(userId);
  stateCache.set(userId, state);
  return state;
}

async function readPlannerState(userId: string): Promise<PlannerState> {
  const user = (await UserModel.findById(userId)
    .select('electronAppSettings.planningSource electronAppSettings.plannerSinceDateKey')
    .lean()) as any;
  const settings = user?.electronAppSettings;
  return {
    enabled: settings?.planningSource === 'planner',
    sinceDateKey: settings?.plannerSinceDateKey || null,
  };
}

export const plannerEnabled = async (userId: string): Promise<boolean> =>
  (await getPlannerState(userId)).enabled;

// One process serves one local user, so an in-memory chain is enough to keep
// two overlapping reads from carrying the same task over twice.
const chains = new Map<string, Promise<unknown>>();
const settledFor = new Map<string, string>();

export const serializePlanner = <T>(userId: string, work: () => Promise<T>): Promise<T> => {
  const next = (chains.get(userId) || Promise.resolve()).then(work, work);
  chains.set(
    userId,
    next.catch(() => undefined)
  );
  return next;
};

export const forgetRollover = (userId: string): void => {
  settledFor.delete(userId);
};

/**
 * Moves unfinished planner tasks from earlier days into today's queue. Runs at
 * most once per local day unless a change (see `forgetRollover`) asks again.
 * Finished tasks stay on the day they were completed.
 */
export async function rollOverUnfinished(userId: string, now = Date.now()): Promise<boolean> {
  const today = todayKey(now);
  if (settledFor.get(userId) === today) return false;
  return serializePlanner(userId, async () => {
    if (settledFor.get(userId) === today) return false;
    const state = await getPlannerState(userId);
    if (!state.enabled) return false;
    const earlier = (await GoalPlanModel.find({
      userId,
      scope: 'daily',
      periodKey: { $gte: state.sinceDateKey || today, $lt: today },
      tasks: { $elemMatch: { completedAtMs: null } },
    }).lean()) as Array<{ periodKey: string; tasks: GoalTask[] }>;
    if (!earlier.length) {
      settledFor.set(userId, today);
      return false;
    }
    const current = (await GoalPlanModel.findOne({
      userId,
      scope: 'daily',
      periodKey: today,
    }).lean()) as { tasks?: GoalTask[] } | null;
    const tasks = carryOver(
      (current?.tasks || []) as GoalTask[],
      earlier.map((plan) => ({ dateKey: plan.periodKey, tasks: plan.tasks || [] }))
    );
    // Write today first: if the process stops in between, a task is briefly
    // on two days (and deduplicated by id next time) rather than lost.
    await GoalPlanModel.updateOne(
      { userId, scope: 'daily', periodKey: today },
      { $set: { tasks }, $setOnInsert: { timeZone: zone(), text: '' } },
      { upsert: true }
    );
    for (const plan of earlier)
      await GoalPlanModel.updateOne(
        { userId, scope: 'daily', periodKey: plan.periodKey },
        {
          $set: {
            tasks: normalizeTasks((plan.tasks || []).filter((task) => task.completedAtMs !== null)),
          },
        }
      );
    settledFor.set(userId, today);
    return true;
  });
}
