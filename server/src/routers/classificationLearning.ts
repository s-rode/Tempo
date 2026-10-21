import crypto from 'crypto';
import mongoose, { Schema } from 'mongoose';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { publicProcedure } from '../trpc';
import { verifyToken } from './auth';
import { ActiveWindowEventModel } from '../models/activeWindowEvent';
import { CategoryModel } from '../models/category';
import { FocusRunHistoryModel } from '../models/focusRuntime';
import { CorrectionActionModel, PreferenceControlModel } from '../models/correctionAction';
import { User } from '../models/user';
import { consolidatePreferences } from '../services/categorization/personalizedPolicy';
import {
  migrateLegacyLearning,
  recordCorrectionActions,
} from '../services/categorization/learningActions';
import { manualCorrectionPresentation } from '../services/categorization/categorizationService';
import { sampleProductiveBlocks } from '../services/categorization/reviewSampling';
import { NavigationEpisodeModel } from '../services/categorization/personalizedClassification';
import { invalidateAnalyticsInputs } from '../services/analyticsDataCache';
import type { ActiveWindowEvent } from '../../../shared/types';

const sampleSchema = new Schema({
  userId: String,
  runId: String,
  eventIds: [String],
  ownerName: String,
  title: String,
  goal: String,
  basis: String,
  stratum: String,
  population: Number,
  inclusionProbability: Number,
  slot: Number,
  startedAtMs: Number,
  reviewedAtMs: Number,
  label: { type: String, enum: ['focused', 'distracted', 'unsure', null], default: null },
});
sampleSchema.index({ userId: 1, runId: 1, slot: 1 }, { unique: true });
export const ClassificationReviewSampleModel = mongoose.model(
  'ClassificationReviewSample',
  sampleSchema
);
const token = z.object({ token: z.string() });
const id = z.string().refine((value) => mongoose.Types.ObjectId.isValid(value));

export const classificationLearningProcedures = {
  getClassificationEvent: publicProcedure
    .input(token.extend({ eventId: id }))
    .query(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const event = await ActiveWindowEventModel.findOne({ _id: input.eventId, userId }).lean();
      if (!event) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ...event, eventId: String(event._id) } as ActiveWindowEvent;
    }),
  getScopedPreferences: publicProcedure.input(token).query(async ({ input }) => {
    const userId = verifyToken(input.token).userId;
    await migrateLegacyLearning(userId);
    const [actions, controls, user] = await Promise.all([
      CorrectionActionModel.find({ userId }).lean(),
      PreferenceControlModel.find({ userId }).lean(),
      User.findById(userId).select('electronAppSettings.classifierStrictness').lean(),
    ]);
    return consolidatePreferences(
      actions,
      user?.electronAppSettings?.classifierStrictness || 'strict',
      Date.now(),
      controls as any
    ).map((preference) => ({
      ...preference,
      scopeLabel:
        actions.find((a) =>
          preference.scope === 'list'
            ? a.context.listKey === preference.key
            : a.context.taskKey === preference.key
        )?.context[preference.scope === 'list' ? 'listName' : 'text'] || 'Previous task',
    }));
  }),
  manageScopedPreference: publicProcedure
    .input(
      token.extend({
        preferenceId: z.string().min(1).max(500),
        state: z.enum(['suspended', 'removed', 'active']),
      })
    )
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      await PreferenceControlModel.updateOne(
        { userId, preferenceId: input.preferenceId },
        { $set: { state: input.state, changedAtMs: Date.now() } },
        { upsert: true }
      );
      await User.updateOne({ _id: userId }, { $inc: { classificationLearningRevision: 1 } });
      return { success: true };
    }),
  getClassificationReviewSessions: publicProcedure
    .input(token.extend({ startDateMs: z.number(), endDateMs: z.number() }))
    .query(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const sessions = await FocusRunHistoryModel.find({
        userId,
        endedAtMs: { $gte: input.startDateMs, $lt: input.endDateMs },
      })
        .sort({ endedAtMs: -1 })
        .select('runId run.phases.goal endedAtMs')
        .lean();
      return sessions.map((s) => ({
        runId: s.runId,
        goal: s.run.phases.find((p) => p.goal)?.goal || 'Focus session',
        endedAtMs: s.endedAtMs,
      }));
    }),
  getClassificationReviewSamples: publicProcedure
    .input(token.extend({ runId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const history = await FocusRunHistoryModel.findOne({ userId, runId: input.runId }).lean();
      if (!history)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Completed session not found.' });
      await ClassificationReviewSampleModel.init();
      let samples = await ClassificationReviewSampleModel.find({
        userId,
        runId: input.runId,
      }).lean();
      if (!samples.length) {
        const [events, categories] = await Promise.all([
          ActiveWindowEventModel.find({
            userId,
            'goalSnapshot.sessionId': input.runId,
            timestamp: { $gte: history.run.startedAtMs, $lte: history.endedAtMs },
          })
            .sort({ timestamp: 1 })
            .lean(),
          CategoryModel.find({ userId, isProductive: true }).lean(),
        ]);
        let draw = 0;
        const random = () =>
          crypto
            .createHmac('sha256', process.env.AUTH_SECRET || 'local-development-secret')
            .update(`${userId}:${input.runId}:${draw++}`)
            .digest()
            .readUInt32BE(0) / 0x100000000;
        const blocks = sampleProductiveBlocks(
          events.map((e) => ({ ...e, eventId: String(e._id) }) as ActiveWindowEvent),
          new Set(categories.map((c) => String(c._id))),
          random
        );
        for (const [slot, block] of blocks.entries())
          await ClassificationReviewSampleModel.updateOne(
            { userId, runId: input.runId, slot },
            { $setOnInsert: { ...block, userId, runId: input.runId, slot } },
            { upsert: true }
          );
        samples = await ClassificationReviewSampleModel.find({ userId, runId: input.runId }).lean();
      }
      return samples.map((s) => ({ ...s, id: String(s._id) }));
    }),
  submitClassificationReview: publicProcedure
    .input(
      token.extend({
        sampleId: id,
        requestId: z.string().uuid(),
        label: z.enum(['focused', 'distracted', 'unsure']),
      })
    )
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const sample = await ClassificationReviewSampleModel.findOne({
        _id: input.sampleId,
        userId,
      }).lean();
      if (!sample) throw new TRPCError({ code: 'NOT_FOUND' });
      if (sample.label === input.label) return { success: true };
      if (input.label === 'unsure' && sample.label && sample.label !== 'unsure') {
        await CorrectionActionModel.updateMany(
          { userId, source: 'review', eventIds: { $in: sample.eventIds }, superseded: false },
          { $set: { superseded: true } }
        );
        await User.updateOne({ _id: userId }, { $inc: { classificationLearningRevision: 1 } });
      }
      if (input.label !== 'unsure') {
        const [events, categories, user] = await Promise.all([
          ActiveWindowEventModel.find({ _id: { $in: sample.eventIds }, userId }).lean(),
          CategoryModel.find({ userId }).lean(),
          User.findById(userId)
            .select(
              'electronAppSettings.learnFromCorrections electronAppSettings.classifierStrictness'
            )
            .lean(),
        ]);
        const category = categories.find((c) => c.isProductive === (input.label === 'focused'));
        if (!category)
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'A matching category is required.',
          });
        await recordCorrectionActions({
          userId,
          events,
          state: input.label,
          categoryId: String(category._id),
          enabled: user?.electronAppSettings?.learnFromCorrections !== false,
          source: 'review',
          strictness: user?.electronAppSettings?.classifierStrictness || 'strict',
          actionId: input.requestId,
          originalPolarity: new Map(categories.map((c) => [String(c._id), c.isProductive])),
        });
        await ActiveWindowEventModel.bulkWrite(
          events.map((event) => ({
            updateOne: {
              filter: { _id: event._id, userId },
              update: {
                $set: {
                  ...manualCorrectionPresentation(category, event),
                  categoryId: String(category._id),
                  classificationStatus: 'manual',
                },
              },
            },
          }))
        );
        // Explicit confirmation can renew navigation; passive samples cannot.
        if (input.label === 'focused')
          for (const event of events) {
            const target = event.goalSnapshot?.targets[0];
            if (event.learningToolKey && target)
              await NavigationEpisodeModel.updateOne(
                {
                  userId,
                  key: `${event.learningToolKey}:${target.taskKey}:${event.goalSnapshot?.sessionId || 'none'}`,
                },
                { $set: { startedAtMs: Date.now() } }
              );
          }
        invalidateAnalyticsInputs(userId);
      }
      await ClassificationReviewSampleModel.updateOne(
        { _id: sample._id, userId },
        { $set: { label: input.label, reviewedAtMs: Date.now() } }
      );
      return { success: true };
    }),
};
