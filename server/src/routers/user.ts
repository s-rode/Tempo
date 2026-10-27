import { z } from 'zod';
import { User } from '../models/user';
import { publicProcedure, router } from '../trpc';
import { verifyToken } from './auth';
import { DISTRACTION_SOUNDS, DEFAULT_DISTRACTION_SOUND, resolveDistractionSound } from '../../../shared/distractionSound';

export const userRouter = router({
  updateElectronAppSettings: publicProcedure
    .input(
      z.object({
        token: z.string(),
        calendarZoomLevel: z.number().min(40).max(120).optional(),
        theme: z.enum(['light', 'dark', 'system']).optional(),
        playDistractionSound: z.boolean().optional(),
        distractionSound: z.enum(DISTRACTION_SOUNDS.map((sound) => sound.id) as ['pop', ...Array<(typeof DISTRACTION_SOUNDS)[number]['id']>]).optional(),
        distractionSoundInterval: z.number().min(5).max(300).optional(),
        showDistractionNotifications: z.boolean().optional(),
        showDistractionNotchAlerts: z.boolean().optional(),
        distractionNotificationInterval: z.number().min(60).max(600).optional(),
        notchTimerMode: z.enum(['streak', 'workday']).optional(),
        animateNotchTimerDigits: z.boolean().optional(),
        sessionTransitionAlerts: z.boolean().optional(),
        playSessionTransitionChime: z.boolean().optional(),
        resetWorkdayTimer: z.boolean().optional(),
        focusComparisonMode: z
          .enum(['all_active_days', 'same_day_type', 'same_weekday'])
          .optional(),
        aiTimelineSummaries: z.boolean().optional(),
        classifierStrictness: z.enum(['flexible', 'balanced', 'strict']).optional(),
        learnFromCorrections: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { token, resetWorkdayTimer, ...settings } = input;
      const userId = verifyToken(token).userId;
      const updates: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(settings)) {
        if (value !== undefined) updates[`electronAppSettings.${name}`] = value;
      }
      if (resetWorkdayTimer) updates['electronAppSettings.workdayTimerResetAtMs'] = Date.now();
      const increments =
        input.learnFromCorrections === undefined
          ? undefined
          : { classificationLearningRevision: 1 };
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $set: updates, ...(increments ? { $inc: increments } : {}) },
        { new: true }
      );

      if (!updatedUser) {
        throw new Error('User not found');
      }

      return {
        success: true,
        electronAppSettings: updatedUser.electronAppSettings,
      };
    }),

  getElectronAppSettings: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const user = await User.findById(userId).select('electronAppSettings').lean();
      if (!user) throw new Error('User not found');

      const defaultSettings = {
        calendarZoomLevel: 60,
        theme: 'system',
        playDistractionSound: true,
        distractionSound: DEFAULT_DISTRACTION_SOUND,
        distractionSoundInterval: 30,
        showDistractionNotifications: true,
        showDistractionNotchAlerts: true,
        distractionNotificationInterval: 60,
        notchTimerMode: 'streak',
        animateNotchTimerDigits: false,
        sessionTransitionAlerts: true,
        playSessionTransitionChime: true,
        workdayTimerResetAtMs: null,
        focusComparisonMode: 'all_active_days',
        aiTimelineSummaries: true,
        classifierStrictness: 'strict',
        learnFromCorrections: true,
      };

      return {
        ...defaultSettings,
        ...(user.electronAppSettings || {}),
        distractionSound: resolveDistractionSound(user.electronAppSettings?.distractionSound).id,
      };
    }),
});
