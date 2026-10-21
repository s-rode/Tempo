import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { publicProcedure, router } from '../trpc';
import { verifyToken } from './auth';
import { ReminderIntegrationModel, ReminderMetadataModel } from '../models/reminder';
import {
  getReminderStatus,
  reminderFilterSchema,
  remindersChanged,
  requireLocalReminders,
  serializeReminderMutation,
} from '../services/reminders';
const tokenInput = z.object({ token: z.string() });
const userFor = (token: string) => {
  requireLocalReminders();
  return verifyToken(token).userId;
};

export const remindersRouter = router({
  getStatus: publicProcedure
    .input(tokenInput)
    .query(({ input }) => getReminderStatus(userFor(input.token))),
  setFilter: publicProcedure
    .input(tokenInput.extend({ filter: reminderFilterSchema }))
    .mutation(async ({ input }) => {
      const userId = userFor(input.token);
      return serializeReminderMutation(userId, async () => {
        await ReminderIntegrationModel.updateOne(
          { userId },
          { $set: { filter: input.filter } },
          { upsert: true }
        );
        await remindersChanged(userId);
        return getReminderStatus(userId);
      });
    }),
  setListContext: publicProcedure
    .input(
      tokenInput.extend({
        listId: z.string().min(1).max(1000),
        focusContext: z.string().trim().max(1000),
      })
    )
    .mutation(async ({ input }) => {
      const userId = userFor(input.token);
      return serializeReminderMutation(userId, async () => {
        const state = await getReminderStatus(userId);
        if (!state.lists.some((list) => list.id === input.listId))
          throw new TRPCError({ code: 'NOT_FOUND' });
        await ReminderIntegrationModel.updateOne(
          { userId },
          { $set: { listContexts: { ...state.listContexts, [input.listId]: input.focusContext } } }
        );
        await remindersChanged(userId);
        return getReminderStatus(userId);
      });
    }),
  setTaskMetadata: publicProcedure
    .input(
      tokenInput.extend({
        taskId: z.string().uuid(),
        estimatedMinutes: z.number().int().min(1).max(720).nullable().optional(),
        focusContext: z.string().trim().max(1000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const userId = userFor(input.token);
      return serializeReminderMutation(userId, async () => {
        const update: Record<string, unknown> = {};
        if (input.estimatedMinutes !== undefined) update.estimatedMinutes = input.estimatedMinutes;
        if (input.focusContext !== undefined) update.focusContext = input.focusContext;
        const result = await ReminderMetadataModel.updateOne(
          { userId, id: input.taskId },
          { $set: update }
        );
        if (!result.matchedCount) throw new TRPCError({ code: 'NOT_FOUND' });
        await remindersChanged(userId);
        return { saved: true };
      });
    }),
});
