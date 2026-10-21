import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type {
  NativeReminder,
  ReminderFilter,
  ReminderList,
  ReminderTask,
} from '../../../shared/reminders';
import { ReminderIntegrationModel, ReminderMetadataModel } from '../models/reminder';
import { FocusRuntimeModel } from '../models/focusRuntime';
import { cancelPendingEnrichment } from './categorization/enrichmentScheduler';
import {
  cancelPendingGoalSupportProfiles,
  ensureGoalSupportProfiles,
} from './categorization/goalSupportProfileScheduler';
import {
  calendarDay,
  matchesReminderFilter,
  reminderClassificationText,
  reminderDueDay,
} from './reminderRules';

const mutations = new Map<string, Promise<unknown>>();
export async function serializeReminderMutation<T>(
  userId: string,
  work: () => Promise<T>
): Promise<T> {
  const previous = mutations.get(userId) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  mutations.set(userId, current);
  try {
    return await current;
  } finally {
    if (mutations.get(userId) === current) mutations.delete(userId);
  }
}

export const reminderFilterSchema = z.object({
  match: z.enum(['any', 'all']),
  rules: z
    .array(
      z.union([
        z.object({ kind: z.enum(['due_today', 'overdue', 'due_later', 'no_due_date']) }),
        z.object({
          kind: z.literal('list'),
          listIds: z.array(z.string().min(1).max(1000)).max(1000),
        }),
      ])
    )
    .max(30),
});
const dueSchema = z
  .object({
    year: z.number().int().min(1).max(9999),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    hour: z.number().int().min(0).max(23).optional(),
    minute: z.number().int().min(0).max(59).optional(),
    timeZone: z.string().max(100).optional(),
    timestampMs: z.number().finite().optional(),
  })
  .refine(
    (due) => new Date(Date.UTC(due.year, due.month - 1, due.day)).getUTCDate() === due.day,
    'Invalid due date'
  );
export const reminderSyncSchema = z.object({
  enabled: z.boolean(),
  permission: z.enum(['not_determined', 'granted', 'denied']),
  error: z.enum(['fetch_failed', 'permission_denied']).nullable().optional(),
  snapshot: z
    .object({
      lists: z
        .array(
          z.object({
            id: z.string().min(1).max(1000),
            name: z.string().max(1000),
            accountName: z.string().max(1000),
          })
        )
        .max(10000),
      reminders: z
        .array(
          z.object({
            sourceId: z.string().min(1).max(1000),
            title: z.string().max(10000),
            listId: z.string().min(1).max(1000),
            due: dueSchema.nullable(),
            completed: z.boolean(),
          })
        )
        .max(100000),
    })
    .optional(),
});

export function requireLocalReminders(): void {
  if (process.env.TEMPO_LOCAL_MODE !== 'true')
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Reminders is available in Tempo Local on macOS.',
    });
}
export const getReminderIntegration = async (userId: string) =>
  process.env.TEMPO_LOCAL_MODE === 'true'
    ? ReminderIntegrationModel.findOne({ userId }).lean()
    : null;

export async function getReminderTasks(
  userId: string,
  now = Date.now()
): Promise<{ enabled: boolean; canStart: boolean; tasks: ReminderTask[] }> {
  const state = await getReminderIntegration(userId);
  if (!state?.enabled) return { enabled: false, canStart: false, tasks: [] };
  const metadata = await ReminderMetadataModel.find({ userId }).lean();
  const bySource = new Map(metadata.map((entry) => [entry.sourceId, entry]));
  const lists = new Map((state.lists as ReminderList[]).map((list) => [list.id, list]));
  const contexts = (state.listContexts || {}) as Record<string, string>;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const filter = state.filter as ReminderFilter;
  const tasks = (state.reminders as NativeReminder[])
    .filter((entry) => matchesReminderFilter(entry, filter, now, zone))
    .map((entry): ReminderTask | null => {
      const meta = bySource.get(entry.sourceId);
      if (!meta) return null;
      const listName = lists.get(entry.listId)?.name || 'Unavailable list';
      const listContext = contexts[entry.listId] || '';
      return {
        id: meta.id,
        source: 'reminder',
        text: entry.title,
        position: 0,
        completedAtMs: null,
        estimatedMinutes: meta.estimatedMinutes ?? null,
        listId: entry.listId,
        listName,
        due: entry.due,
        customFocusContext: meta.focusContext || '',
        listFocusContext: listContext,
        focusContext: meta.focusContext?.trim() || listContext,
        classificationText: reminderClassificationText(
          entry.title,
          listName,
          meta.focusContext,
          listContext
        ),
      };
    })
    .filter((task): task is ReminderTask => Boolean(task));
  const dueKey = (task: ReminderTask) =>
    task.due
      ? `${reminderDueDay(task.due, zone)}T${
          task.due.timestampMs !== undefined && task.due.hour !== undefined
            ? new Date(task.due.timestampMs).toLocaleTimeString('en-GB', {
                timeZone: zone,
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
              })
            : `${String(task.due.hour ?? 0).padStart(2, '0')}:${String(task.due.minute ?? 0).padStart(2, '0')}`
        }`
      : '9999-99-99';
  tasks.sort(
    (a, b) =>
      dueKey(a).localeCompare(dueKey(b)) || a.text.localeCompare(b.text) || a.id.localeCompare(b.id)
  );
  tasks.forEach((task, index) => {
    task.position = index;
  });
  return { enabled: true, canStart: state.permission === 'granted', tasks };
}

/** Update live and future phases; timestamped context segments remain immutable. */
export function applyReminderContextToRun(
  run: any,
  taskId: string,
  classificationText: string,
  now: number,
  provenance?: { listId: string; listName: string; listContext: string }
): boolean {
  if (run?.state !== 'active') return false;
  let changed = false;
  for (const phase of run.phases || []) {
    const ref = phase.todayPlanTask;
    if (
      phase.kind !== 'work' ||
      phase.state === 'completed' ||
      ref?.source !== 'reminder' ||
      ref.taskId !== taskId ||
      (ref.classificationText === classificationText &&
        (!provenance ||
          (ref.listId === provenance.listId &&
            ref.listName === provenance.listName &&
            ref.listContext === provenance.listContext)))
    )
      continue;
    if (phase.startedAtMs) {
      const snapshot = ref.toObject ? ref.toObject() : { ...ref };
      if (!phase.goalHistory?.length)
        phase.goalHistory = [
          { goal: phase.goal, todayPlanTask: { ...snapshot }, startedAtMs: phase.startedAtMs },
        ];
      phase.goalHistory.push({
        goal: phase.goal,
        todayPlanTask: { ...snapshot, classificationText, ...provenance },
        startedAtMs: now,
      });
    }
    ref.classificationText = classificationText;
    if (provenance) Object.assign(ref, provenance);
    changed = true;
  }
  if (
    run.taskTarget?.source === 'reminder' &&
    run.taskTarget.taskId === taskId &&
    (run.taskTarget.classificationText !== classificationText ||
      (provenance &&
        (run.taskTarget.listId !== provenance.listId ||
          run.taskTarget.listContext !== provenance.listContext ||
          run.taskTarget.listName !== provenance.listName)))
  ) {
    run.taskTarget.classificationText = classificationText;
    if (provenance) Object.assign(run.taskTarget, provenance);
    changed = true;
  }
  return changed;
}

export async function remindersChanged(userId: string): Promise<void> {
  cancelPendingEnrichment(userId);
  cancelPendingGoalSupportProfiles(userId);
  // Filters must not detach an active session; resolve all cached items here.
  const state = await getReminderIntegration(userId);
  const runtime = await FocusRuntimeModel.findOne({ userId, 'run.state': 'active' });
  if (state && runtime?.run) {
    const refs = new Set<string>();
    for (const phase of runtime.run.phases)
      if (phase.todayPlanTask?.source === 'reminder') refs.add(phase.todayPlanTask.taskId);
    const metas = await ReminderMetadataModel.find({ userId, id: { $in: [...refs] } }).lean();
    let changed = false;
    for (const meta of metas) {
      const item = (state.reminders as NativeReminder[]).find(
        (entry) => entry.sourceId === meta.sourceId
      );
      if (!item) continue;
      const list = (state.lists as ReminderList[]).find((entry) => entry.id === item.listId);
      const contexts = (state.listContexts || {}) as Record<string, string>;
      changed =
        applyReminderContextToRun(
          runtime.run,
          meta.id,
          reminderClassificationText(
            item.title,
            list?.name || 'Unavailable list',
            meta.focusContext,
            contexts[item.listId]
          ),
          Date.now(),
          {
            listId: item.listId,
            listName: list?.name || 'Unavailable list',
            listContext: contexts[item.listId] || '',
          }
        ) || changed;
    }
    if (changed) {
      // Mongoose tracks the changed context fields and history segments. Do
      // not mark the entire run: that could overwrite concurrent timer work.
      const { saveRuntime } = await import('./focusRuntime');
      await saveRuntime(runtime);
    }
  }
  const { resolveEffectiveGoalContext } = await import('./goalPlans');
  ensureGoalSupportProfiles(userId, await resolveEffectiveGoalContext(userId));
}

export const applyReminderSync = (
  userId: string,
  input: z.infer<typeof reminderSyncSchema>
): Promise<void> => serializeReminderMutation(userId, () => persistReminderSync(userId, input));

async function persistReminderSync(
  userId: string,
  input: z.infer<typeof reminderSyncSchema>
): Promise<void> {
  if (input.snapshot && input.permission !== 'granted')
    throw new Error('Snapshot requires Reminders permission.');
  const update: Record<string, unknown> = {
    enabled: input.enabled,
    permission: input.permission,
    error: input.error || null,
  };
  if (input.snapshot) {
    const lists = new Map(input.snapshot.lists.map((list) => [list.id, list]));
    const reminders = new Map<string, NativeReminder>();
    for (const entry of input.snapshot.reminders) {
      if (!lists.has(entry.listId)) throw new Error('Incomplete reminder snapshot.');
      reminders.set(entry.sourceId, entry);
    }
    if (reminders.size)
      await ReminderMetadataModel.bulkWrite(
        [...reminders.values()].map((entry) => ({
          updateOne: {
            filter: { userId, sourceId: entry.sourceId },
            update: {
              $setOnInsert: {
                userId,
                sourceId: entry.sourceId,
                id: randomUUID(),
                estimatedMinutes: null,
                focusContext: '',
              },
            },
            upsert: true,
          },
        }))
      );
    update.lists = [...lists.values()];
    update.reminders = [...reminders.values()];
    update.lastSuccessAtMs = Date.now();
  }
  await ReminderIntegrationModel.updateOne({ userId }, { $set: update }, { upsert: true });
  await remindersChanged(userId);
}

export async function getReminderStatus(userId: string) {
  const state = await getReminderIntegration(userId);
  return {
    enabled: state?.enabled || false,
    permission: state?.permission || 'not_determined',
    lastSuccessAtMs: state?.lastSuccessAtMs ?? null,
    error: state?.error ?? null,
    lists: (state?.lists || []) as ReminderList[],
    listContexts: (state?.listContexts || {}) as Record<string, string>,
    filter: (state?.filter || {
      match: 'any',
      rules: [{ kind: 'due_today' }, { kind: 'overdue' }],
    }) as ReminderFilter,
    dayKey: calendarDay(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone),
  };
}
