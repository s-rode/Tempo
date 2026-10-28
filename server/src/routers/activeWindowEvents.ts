import { prepareDistractionNotification } from '../services/categorization/distractionNudge';
import { snapshotGoalContext } from '../services/goalPlans';
import { CorrectionActionModel, PreferenceControlModel } from '../models/correctionAction';
import {
  classificationLearningProcedures,
  ClassificationReviewSampleModel,
} from './classificationLearning';
import type { PersonalizedEventMetadata } from '../../../shared/classification';
import { recordCorrectionActions } from '../services/categorization/learningActions';
import { TRPCError } from '@trpc/server';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ActiveWindowEvent, MAX_ACTIVITY_CONTENT_CHARACTERS } from '../../../shared/types';
import { ActiveWindowEventModel } from '../models/activeWindowEvent';
import { ActivityCorrectionRuleModel } from '../models/activityCorrectionRule';
import { CategoryModel } from '../models/category';
import {
  categorizeActivity,
  manualCorrectionPresentation,
  resolveGoalContext,
} from '../services/categorization/categorizationService';
import {
  activityKeyFor,
  fingerprintCapturedContent,
  learningToolIdentityFor,
} from '../services/categorization/activityIdentity';
import { isReusableFirefoxNavigationSource } from '../services/categorization/navigationCache';
import { ClassificationStatus } from '../services/categorization/provider';
import { publicProcedure, router } from '../trpc';
import { verifyToken } from './auth';
import { resumeAfterSystemCapture, setSystemSuspension } from '../services/focusRuntime';
import {
  beginEnrichmentCapture,
  cancelPendingEnrichment,
  scheduleEnrichment,
} from '../services/categorization/enrichmentScheduler';
import { cancelPendingGoalSupportProfiles } from '../services/categorization/goalSupportProfileScheduler';
import { ClassifierFeedbackModel } from '../models/classifierFeedback';
import { User as UserModel } from '../models/user';
import { CLASSIFIER_POLICY_VERSION } from '../services/categorization/pageDescriptors';
import { invalidateAnalyticsInputs } from '../services/analyticsDataCache';
import {
  correctionLearningPatternKey,
  goalProfileSnapshot,
} from '../services/categorization/correctionLearning';

// Zod schema for input validation
const activeWindowEventInputSchema = z.object({
  token: z.string(),
  windowId: z.number().optional(),
  ownerName: z.string(),
  type: z.enum(['window', 'browser', 'system']),
  browser: z.enum(['chrome', 'safari', 'firefox']).optional().nullable(),
  title: z.string(),
  url: z.string().optional().nullable(),
  content: z.string().max(MAX_ACTIVITY_CONTENT_CHARACTERS).optional().nullable(),
  contentSource: z.enum(['dom', 'ocr', 'title']).optional().nullable(),
  siteHost: z.string().max(253).optional().nullable(),
  siteIdentity: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional()
    .nullable(),
  contentCaptureStatus: z
    .enum(['captured', 'permission_denied', 'capture_failed', 'no_text', 'navigation_pending'])
    .optional()
    .nullable(),
  captureReason: z
    .enum([
      'app_switch',
      'periodic_backup',
      'firefox_activation',
      'firefox_tab_switch',
      'system_lock',
      'system_unlock',
      'system_sleep',
      'system_wake',
      'system_lock_initial',
    ])
    .optional()
    .nullable(),
  timestamp: z.number(),
  screenshotS3Url: z.string().optional().nullable(),
  navigationFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional()
    .nullable(),
  pageCorrectionKey: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional()
    .nullable(),
  monitoringCaptureId: z.string().uuid().optional(),
});

export const activeWindowEventsRouter = router({
  prepareDistractionNotification: publicProcedure
    .input(z.object({ token: z.string(), eventId: z.string().regex(/^[a-f0-9]{24}$/i) }))
    .mutation(({ input }) => prepareDistractionNotification(verifyToken(input.token).userId, input.eventId)),

  ...classificationLearningProcedures,
  // An explicit relevance choice must work even if the original upload never
  // reached persistence. Observe the activity now; do not invent past context.
  prepareCurrentActivityCorrection: publicProcedure
    .input(
      z.object({
        token: z.string(),
        monitoringCaptureId: z.string().uuid(),
        ownerName: z.string().min(1).max(100),
        title: z.string().max(2000),
        type: z.enum(['window', 'browser']),
        browser: z.enum(['chrome', 'safari', 'firefox']).optional().nullable(),
        windowId: z.number().optional(),
        siteIdentity: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional()
          .nullable(),
        pageCorrectionKey: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional()
          .nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const userId = verifyToken(input.token).userId;
      const filter = { userId, monitoringCaptureId: input.monitoringCaptureId };
      const existing = await ActiveWindowEventModel.findOne(filter).lean();
      const tool = learningToolIdentityFor(input);
      if (existing) {
        // A current explicit correction can fill missing opaque identity for
        // this exact page, without changing its historical goal or labels.
        if (
          !existing.learningToolKey &&
          tool &&
          input.pageCorrectionKey &&
          existing.pageCorrectionKey === input.pageCorrectionKey
        ) {
          const identity = {
            learningToolKey: tool.key,
            learningToolKind: tool.kind,
            learningToolLabel: tool.label,
          };
          await ActiveWindowEventModel.updateOne(
            { _id: existing._id, userId, learningToolKey: null },
            { $set: identity }
          );
          Object.assign(existing, identity);
        }
        return { ...existing, eventId: String(existing._id) } as ActiveWindowEvent;
      }
      const context = await resolveGoalContext(userId);
      await ActiveWindowEventModel.init();
      const event = await ActiveWindowEventModel.findOneAndUpdate(
        filter,
        {
          $setOnInsert: {
            ...filter,
            ownerName: input.ownerName,
            title: input.title,
            type: input.type,
            browser: input.browser,
            windowId: input.windowId,
            pageCorrectionKey: input.pageCorrectionKey || null,
            activityKey: activityKeyFor(input, null),
            timestamp: Date.now(),
            categoryId: null,
            classificationStatus: 'invalid_response',
            classificationBasis: 'technical_failure',
            categoryReasoning: 'Awaiting your classification.',
            goalSnapshot: snapshotGoalContext(context.goals),
            goalContextFingerprint: context.fingerprint,
            classificationContextFingerprint: context.classificationFingerprint,
            learningToolKey: tool?.key || null,
            learningToolKind: tool?.kind || null,
            learningToolLabel: tool?.label || null,
          },
        },
        { upsert: true, new: true }
      ).lean();
      invalidateAnalyticsInputs(userId);
      return { ...event!, eventId: String(event!._id) } as ActiveWindowEvent;
    }),
  create: publicProcedure.input(activeWindowEventInputSchema).mutation(async ({ input }) => {
    const requestStartedAt = performance.now();
    const decodedToken = verifyToken(input.token);
    const userId = decodedToken.userId;
    if (input.monitoringCaptureId) {
      const existing = await ActiveWindowEventModel.findOne({
        userId,
        monitoringCaptureId: input.monitoringCaptureId,
      }).lean();
      if (existing) return { ...existing, eventId: String(existing._id) } as ActiveWindowEvent;
    }
    const enrichmentGeneration = beginEnrichmentCapture(userId);

    // Destructure relevant details from input for categorization
    const {
      windowId,
      ownerName,
      type,
      browser,
      title,
      url,
      content,
      contentSource,
      siteHost,
      siteIdentity,
      contentCaptureStatus,
      captureReason,
      timestamp,
      screenshotS3Url,
      navigationFingerprint,
      pageCorrectionKey,
      monitoringCaptureId,
    } = input;
    const activityDetails = {
      ownerName,
      type,
      browser,
      title,
      url,
      siteHost,
      siteIdentity,
      content,
      contentSource: contentSource || (type === 'system' ? null : 'title'),
      pageCorrectionKey,
    };

    const systemTransition = (() => {
      if (type !== 'system') return null;
      const text = `${ownerName} ${title}`.toLowerCase();
      if (text.includes('unlock')) return 'unlock' as const;
      if (text.includes('wake')) return 'wake' as const;
      if (text.includes('sleep')) return 'sleep' as const;
      if (text.includes('lock')) return 'lock' as const;
      return null;
    })();
    if (systemTransition) {
      await setSystemSuspension(userId, systemTransition);
      if (systemTransition === 'lock' || systemTransition === 'sleep')
        cancelPendingGoalSupportProfiles(userId);
    }
    if (type !== 'system') {
      const tracking = await resumeAfterSystemCapture(userId);
      if (tracking.suspension.reasons.includes('calendar_event')) {
        const boundary = await ActiveWindowEventModel.findOne({userId, type: 'system', ownerName: 'Calendar Pause'}).sort({timestamp: -1}).lean();
        if (boundary) return {...boundary, eventId: String(boundary._id)} as ActiveWindowEvent;
        throw new TRPCError({code: 'PRECONDITION_FAILED', message: 'Tracking is paused for a calendar event.'});
      }
    }

    const categorizationResult: PersonalizedEventMetadata & {
      categoryId: string | null;
      categoryReasoning: string | null;
      classificationStatus: ClassificationStatus;
      activityKey: string;
      pageCorrectionKey: string | null;
      activityLabel: string | null;
      activitySummary: string | null;
      nudgeTitle: string | null;
      nudgeBody: string | null;
      goalContextFingerprint: string | null;
      classificationContextFingerprint: string | null;
      goalRelation: 'direct' | 'supporting' | 'none' | 'insufficient' | null;
      supportingMode: string | null;
      classificationFailureCode?:
        | import('../services/categorization/provider').ClassificationFailureCode
        | null;
      classificationAttemptCount?: number;
      pageDescriptorRevision?: string | null;
      pageKind?: string | null;
      pageDescriptorTopicCues?: string[] | null;
      evidenceQuality?: 'strong' | 'partial' | 'weak' | null;
      decisionConfidence?: 'high' | 'medium' | 'low' | null;
      matchedGoalRef?: string | null;
      classificationLatencyMs?: number | null;
      classifierStrictness: import('../../../shared/types').ClassifierStrictness;
      learningToolKey?: string | null;
      learningToolKind?: 'app' | 'site' | null;
      learningToolLabel?: string | null;
      learningExampleId?: string | null;
    } =
      type === 'system'
        ? {
            categoryId: null,
            categoryReasoning: null,
            classificationStatus: 'insufficient_context',
            activityKey: activityKeyFor(activityDetails, null),
            pageCorrectionKey: null,
            activityLabel: title || ownerName,
            activitySummary: null,
            nudgeTitle: null,
            nudgeBody: null,
            goalContextFingerprint: null,
            classificationContextFingerprint: null,
            goalRelation: null,
            supportingMode: null,
            classificationFailureCode: null,
            classificationAttemptCount: 0,
            classifierStrictness: 'strict',
          }
        : await categorizeActivity(userId, activityDetails);
    const categoryId = categorizationResult.categoryId;

    const eventToSave: ActiveWindowEvent = {
      userId,
      windowId,
      ownerName,
      type,
      browser,
      title,
      // Firefox URLs and hostnames never enter persistence or API responses.
      url: type === 'browser' ? undefined : url,
      // Page text is used only for this request. Never persist it.
      content: undefined,
      contentSource: contentSource || (type === 'system' ? null : 'title'),
      contentCaptureStatus,
      contentFingerprint: browser === 'firefox' ? fingerprintCapturedContent(content) : null,
      activityKey: categorizationResult.activityKey,
      pageCorrectionKey: categorizationResult.pageCorrectionKey,
      goalContextFingerprint: categorizationResult.goalContextFingerprint,
      classificationContextFingerprint: categorizationResult.classificationContextFingerprint,
      goalRelation: categorizationResult.goalRelation,
      supportingMode: categorizationResult.supportingMode,
      activityLabel: categorizationResult.activityLabel,
      activitySummary: categorizationResult.activitySummary,
      captureReason,
      timestamp,
      screenshotS3Url,
      navigationFingerprint,
      goalSnapshot: categorizationResult.goalSnapshot,
      classificationBasis: categorizationResult.classificationBasis,
      semanticProposal: categorizationResult.semanticProposal,
      preferenceId: categorizationResult.preferenceId,
      decisionExpiresAtMs: categorizationResult.decisionExpiresAtMs,
      categoryId, // Add categoryId from categorization service
      categoryReasoning: categorizationResult.categoryReasoning,
      nudgeTitle: categorizationResult.nudgeTitle,
      nudgeBody: categorizationResult.nudgeBody,
      classificationStatus: categorizationResult.classificationStatus,
      classificationFailureCode: categorizationResult.classificationFailureCode || null,
      classificationAttemptCount: categorizationResult.classificationAttemptCount || 0,
      pageDescriptorRevision: categorizationResult.pageDescriptorRevision || null,
      pageKind: categorizationResult.pageKind || null,
      pageDescriptorTopicCues: categorizationResult.pageDescriptorTopicCues || [],
      evidenceQuality: categorizationResult.evidenceQuality || null,
      decisionConfidence: categorizationResult.decisionConfidence || null,
      matchedGoalRef: categorizationResult.matchedGoalRef || null,
      classificationLatencyMs: categorizationResult.classificationLatencyMs || null,
      classifierStrictness: categorizationResult.classifierStrictness,
      learningToolKey: categorizationResult.learningToolKey || null,
      learningToolKind: categorizationResult.learningToolKind || null,
      learningToolLabel: categorizationResult.learningToolLabel || null,
      learningExampleId: categorizationResult.learningExampleId || null,
      monitoringCaptureId: monitoringCaptureId || undefined,
    };

    try {
      const newEvent = new ActiveWindowEventModel(eventToSave);

      await newEvent.save();
      invalidateAnalyticsInputs(userId);
      if (
        type !== 'system' &&
        categoryId &&
        categorizationResult.goalContextFingerprint &&
        (categorizationResult.classificationStatus === 'deterministic_direct' ||
          categorizationResult.classificationStatus === 'ollama' ||
          categorizationResult.classificationStatus === 'policy_override')
      ) {
        scheduleEnrichment({
          userId,
          generation: enrichmentGeneration,
          eventId: String(newEvent._id),
          timestamp,
          categoryId,
          goalContextFingerprint: categorizationResult.goalContextFingerprint,
          activity: activityDetails,
        });
      }
      // Never log titles, URLs, OCR, goals, or generated prose. This is only
      // a privacy-safe latency marker for the local path.
      console.info(
        '[classification-timing]',
        JSON.stringify({
          phase: 'event-create',
          totalMs: Math.round(performance.now() - requestStartedAt),
        })
      );
      return { ...newEvent.toObject(), eventId: String(newEvent._id) } as ActiveWindowEvent;
    } catch (error) {
      if (monitoringCaptureId && (error as { code?: number } | null)?.code === 11000) {
        const existing = await ActiveWindowEventModel.findOne({
          userId,
          monitoringCaptureId,
        }).lean();
        if (existing) return { ...existing, eventId: String(existing._id) } as ActiveWindowEvent;
      }
      console.error('Error saving active window event: details withheld to protect activity context.');
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to save active window event',
      });
    }
  }),

  getEventsForDateRange: publicProcedure
    .input(z.object({ token: z.string(), startDateMs: z.number(), endDateMs: z.number() }))
    .query(async ({ input }) => {
      try {
        const decodedToken = verifyToken(input.token);
        const userId = decodedToken.userId;

        // Input times are already UTC milliseconds representing the user's local day/week boundaries
        const { startDateMs, endDateMs } = input;

        if (startDateMs >= endDateMs) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'startDateMs must be before endDateMs.',
          });
        }

        const events = await ActiveWindowEventModel.find({
          userId: userId,
          timestamp: {
            $gte: startDateMs,
            $lt: endDateMs,
          },
        })
          .sort({ timestamp: 1 })
          .lean();

        return events.map(
          (event) => ({ ...event, eventId: String(event._id) }) as ActiveWindowEvent
        );
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('Error fetching events for date range: details withheld to protect activity context.');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch events for date range',
        });
      }
    }),

  getLatestEvent: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      try {
        const decodedToken = verifyToken(input.token);
        const userId = decodedToken.userId;

        const latestEvent = await ActiveWindowEventModel.findOne({
          userId: userId,
        })
          .sort({ timestamp: -1 })
          .limit(1)
          .lean();

        if (!latestEvent) {
          return null; // Or throw a TRPCError if an event is always expected
        }
        return { ...latestEvent, eventId: String(latestEvent._id) } as ActiveWindowEvent;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('Error fetching latest event: details withheld to protect activity context.');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch latest event',
        });
      }
    }),

  /**
   * Reuses a remembered page correction before Firefox OCR. The legacy
   * navigation cache remains a separate exact-document fast path.
   */
  reuseFirefoxNavigation: publicProcedure
    .input(
      z.object({
        token: z.string(),
        windowId: z.number(),
        title: z.string(),
        navigationFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        pageCorrectionKey: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional()
          .nullable(),
        captureReason: z.enum(['firefox_activation', 'firefox_tab_switch']),
        timestamp: z.number(),
        monitoringCaptureId: z.string().uuid().optional(),
        siteIdentity: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional()
          .nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const decoded = verifyToken(input.token);
      const userId = decoded.userId;
      if (input.monitoringCaptureId) {
        const existing = await ActiveWindowEventModel.findOne({
          userId,
          monitoringCaptureId: input.monitoringCaptureId,
        }).lean();
        if (existing)
          return {
            reused: true as const,
            event: { ...existing, eventId: String(existing._id) } as ActiveWindowEvent,
          };
      }
      beginEnrichmentCapture(userId);
      const context = await resolveGoalContext(userId);
      const pageCorrectionRule = input.pageCorrectionKey
        ? await ActivityCorrectionRuleModel.findOne({
            userId,
            pageCorrectionKey: input.pageCorrectionKey,
            goalContextFingerprint: context.fingerprint,
          }).lean()
        : null;
      if (pageCorrectionRule) {
        const category = await CategoryModel.findOne({
          _id: pageCorrectionRule.categoryId,
          userId,
        }).lean();
        if (category) {
          const activity = {
            ownerName: 'Firefox',
            title: input.title,
            type: 'browser' as const,
            browser: 'firefox' as const,
            url: null,
            pageCorrectionKey: input.pageCorrectionKey,
          };
          const presentation = manualCorrectionPresentation(category, activity);
          const previousTool = await ActiveWindowEventModel.findOne({
            userId,
            pageCorrectionKey: input.pageCorrectionKey,
            learningToolKey: { $ne: null },
          })
            .sort({ timestamp: -1 })
            .select('learningToolKey learningToolKind learningToolLabel')
            .lean();
          const event = new ActiveWindowEventModel({
            userId,
            windowId: input.windowId,
            ...activity,
            content: undefined,
            contentSource: null,
            contentCaptureStatus: 'captured',
            contentFingerprint: null,
            navigationFingerprint: input.navigationFingerprint,
            activityKey: activityKeyFor(activity, null),
            goalContextFingerprint: context.fingerprint,
            classificationContextFingerprint: context.classificationFingerprint,
            goalRelation: null,
            supportingMode: null,
            activityLabel: presentation.activityLabel,
            activitySummary: presentation.activitySummary,
            categoryId: category._id.toString(),
            categoryReasoning: presentation.categoryReasoning,
            nudgeTitle: null,
            nudgeBody: null,
            classificationStatus: 'manual_rule',
            goalSnapshot: snapshotGoalContext(context.goals),
            classificationBasis: 'manual',
            learningToolKey: previousTool?.learningToolKey || input.siteIdentity || null,
            learningToolKind:
              previousTool?.learningToolKind || (input.siteIdentity ? 'site' : null),
            learningToolLabel:
              previousTool?.learningToolLabel || (input.siteIdentity ? 'Firefox website' : null),
            captureReason: input.captureReason,
            timestamp: input.timestamp,
            classifierStrictness: context.strictness,
            monitoringCaptureId: input.monitoringCaptureId || null,
          });
          await event.save();
          invalidateAnalyticsInputs(userId);
          return {
            reused: true as const,
            event: { ...event.toObject(), eventId: String(event._id) } as ActiveWindowEvent,
          };
        }
      }
      const source = await ActiveWindowEventModel.findOne({
        userId,
        navigationFingerprint: input.navigationFingerprint,
        classificationContextFingerprint: context.classificationFingerprint,
        // A navigation fingerprint alone is not enough: the bridge can be a
        // fraction of a second behind Firefox's visible tab title. Cache only
        // a direct core result for this exact document/title pair, never a
        // previous cache hit that could otherwise propagate a stale category.
        title: input.title,
        classificationStatus: { $in: ['deterministic_direct', 'ollama', 'policy_override'] },
        categoryId: { $ne: null },
        $or: [
          { classificationStatus: 'deterministic_direct' },
          {
            decisionConfidence: { $in: ['high', 'medium'] },
            evidenceQuality: { $in: ['strong', 'partial'] },
          },
        ],
      })
        .sort({ timestamp: -1 })
        .lean();
      if (
        !source ||
        source.classificationBasis === 'resource_navigation' ||
        (source.decisionExpiresAtMs && source.decisionExpiresAtMs <= Date.now()) ||
        !isReusableFirefoxNavigationSource(source, input.title)
      ) {
        return { reused: false as const };
      }

      const event = new ActiveWindowEventModel({
        userId,
        windowId: input.windowId,
        ownerName: 'Firefox',
        type: 'browser',
        browser: 'firefox',
        title: input.title,
        content: undefined,
        contentSource: null,
        contentCaptureStatus: 'captured',
        goalSnapshot: source.goalSnapshot,
        classificationBasis: source.classificationBasis,
        semanticProposal: source.semanticProposal,
        preferenceId: source.preferenceId,
        decisionExpiresAtMs: source.decisionExpiresAtMs,
        contentFingerprint: source.contentFingerprint || null,
        navigationFingerprint: input.navigationFingerprint,
        pageCorrectionKey: input.pageCorrectionKey || source.pageCorrectionKey || null,
        activityKey: source.activityKey,
        goalContextFingerprint: context.fingerprint,
        classificationContextFingerprint: context.classificationFingerprint,
        goalRelation: source.goalRelation || null,
        supportingMode: source.supportingMode || null,
        pageDescriptorRevision: source.pageDescriptorRevision || null,
        pageKind: source.pageKind || null,
        pageDescriptorTopicCues: source.pageDescriptorTopicCues || [],
        evidenceQuality: source.evidenceQuality || null,
        decisionConfidence: source.decisionConfidence || null,
        matchedGoalRef: source.matchedGoalRef || null,
        learningToolKey: source.learningToolKey || input.siteIdentity || null,
        learningToolKind: source.learningToolKind || (input.siteIdentity ? 'site' : null),
        learningToolLabel:
          source.learningToolLabel || (input.siteIdentity ? 'Firefox website' : null),
        learningExampleId: source.learningExampleId || null,
        classificationLatencyMs: 0,
        activityLabel: source.activityLabel,
        activitySummary: source.activitySummary,
        categoryId: source.categoryId,
        categoryReasoning: source.categoryReasoning,
        nudgeTitle: source.nudgeTitle,
        nudgeBody: source.nudgeBody,
        classificationStatus: 'navigation_cache',
        captureReason: input.captureReason,
        timestamp: input.timestamp,
        classifierStrictness: context.strictness,
        monitoringCaptureId: input.monitoringCaptureId || null,
      });
      await event.save();
      invalidateAnalyticsInputs(userId);
      return {
        reused: true as const,
        event: { ...event.toObject(), eventId: String(event._id) } as ActiveWindowEvent,
      };
    }),

  getCorrectionLearningTargets: publicProcedure
    .input(
      z.object({
        token: z.string(),
        eventIds: z
          .array(z.string().refine((value) => mongoose.Types.ObjectId.isValid(value)))
          .min(1)
          .max(500),
      })
    )
    .query(async ({ input }) => {
      const decoded = verifyToken(input.token);
      const [events, context] = await Promise.all([
        ActiveWindowEventModel.find({ _id: { $in: input.eventIds }, userId: decoded.userId })
          .select('goalContextFingerprint type learningToolKey categoryId')
          .lean(),
        resolveGoalContext(decoded.userId),
      ]);
      if (events.length !== input.eventIds.length) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'One or more activity events are unavailable.',
        });
      }
      const historical = await ActiveWindowEventModel.find({
        _id: { $in: input.eventIds },
        userId: decoded.userId,
      })
        .select('goalSnapshot')
        .lean();
      const targets = [
        ...new Map(
          historical
            .flatMap((e) => e.goalSnapshot?.targets || [])
            .map((t) => [t.ref, { ref: t.ref, text: t.text, scope: context.goals.scope }])
        ).values(),
      ];
      const matchingContext = context.learnFromCorrections && targets.length > 0;
      return {
        eligible: matchingContext && targets.length > 0,
        targets,
        automaticGoalRef: targets.length === 1 ? targets[0].ref : null,
        requiresGoalSelection: historical.some(
          (event) => (event.goalSnapshot?.targets.length || 0) > 1
        ),
        currentCategoryId: events.length === 1 ? events[0].categoryId || null : null,
      };
    }),

  recategorizeBlock: publicProcedure
    .input(
      z.object({
        token: z.string(),
        eventIds: z
          .array(z.string().refine((value) => mongoose.Types.ObjectId.isValid(value)))
          .min(1)
          .max(500),
        newCategoryId: z.string().refine((val) => mongoose.Types.ObjectId.isValid(val), {
          message: 'Invalid Object ID for newCategoryId',
        }),
        rememberExactMatch: z.boolean().default(true),
        learnFromCorrection: z.boolean().default(true),
        learningGoalRef: z.string().min(1).max(180).optional(),
        correctionActionId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const decodedToken = verifyToken(input.token);
      const userId = decodedToken.userId;
      cancelPendingEnrichment(userId);

      try {
        const events = await ActiveWindowEventModel.find({
          _id: { $in: input.eventIds },
          userId,
        }).lean();
        if (events.length !== input.eventIds.length) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'One or more activity events are unavailable.',
          });
        }

        const category = await CategoryModel.findOne({ _id: input.newCategoryId, userId }).lean();
        if (!category) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'The selected category is unavailable.',
          });
        }

        const storedEvents = events as unknown as Array<
          PersonalizedEventMetadata & {
            _id: mongoose.Types.ObjectId;
            ownerName: string;
            title?: string | null;
            type: 'window' | 'browser' | 'system';
            browser?: 'chrome' | 'safari' | 'firefox' | null;
            activityKey?: string;
            pageCorrectionKey?: string | null;
            goalContextFingerprint?: string | null;
            activityLabel?: string;
            activitySummary?: string;
            categoryId?: string | null;
            classificationStatus?: string;
            pageDescriptorRevision?: string | null;
            pageKind?: string | null;
            supportingMode?: string | null;
            pageDescriptorTopicCues?: string[] | null;
            learningToolKey?: string | null;
            learningToolKind?: 'app' | 'site' | null;
            learningToolLabel?: string | null;
            matchedGoalRef?: string | null;
          }
        >;
        const firstEvent = storedEvents[0];
        const correctionContext = await resolveGoalContext(userId);
        const originalCategories = await CategoryModel.find({
          userId,
          _id: { $in: storedEvents.map((e) => e.categoryId).filter(Boolean) },
        }).lean();
        const originalPolarity = new Map(
          originalCategories.map((c) => [String(c._id), Boolean(c.isProductive)])
        );
        const learnedState = category.isProductive ? ('focused' as const) : ('distracted' as const);
        const learned = await recordCorrectionActions({
          userId,
          events: storedEvents,
          state: learnedState,
          categoryId: input.newCategoryId,
          enabled: input.learnFromCorrection && correctionContext.learnFromCorrections,
          goalRef: input.learningGoalRef,
          originalPolarity,
          actionId: input.correctionActionId,
          strictness: correctionContext.strictness,
        });
        const updateResult = await ActiveWindowEventModel.bulkWrite(
          storedEvents.map((event) => {
            const presentation = manualCorrectionPresentation(category, event);
            return {
              updateOne: {
                filter: { _id: event._id, userId },
                update: {
                  $set: {
                    categoryId: input.newCategoryId,
                    categoryReasoning: presentation.categoryReasoning,
                    activityLabel: presentation.activityLabel,
                    activitySummary: presentation.activitySummary,
                    classificationStatus: 'manual',
                    nudgeTitle: null,
                    nudgeBody: null,
                  },
                },
              },
            };
          })
        );
        invalidateAnalyticsInputs(userId);

        const goalFingerprints = new Set(
          storedEvents.map((event) => event.goalContextFingerprint || null)
        );
        const sharedGoalContext =
          goalFingerprints.size === 1 ? firstEvent.goalContextFingerprint || null : null;
        const pageCorrectionKeys = new Set(
          storedEvents
            .map((event) => event.pageCorrectionKey)
            .filter((value): value is string => /^[a-f0-9]{64}$/.test(value || ''))
        );
        const isOneBrowserPage =
          goalFingerprints.size === 1 &&
          pageCorrectionKeys.size === 1 &&
          Boolean(firstEvent.activityKey) &&
          storedEvents.every(
            (event) =>
              event.type === 'browser' && event.pageCorrectionKey === [...pageCorrectionKeys][0]
          );
        const exactKeys = new Set(
          storedEvents
            .map((event) => event.activityKey)
            .filter((value): value is string => Boolean(value))
        );
        const isOneExactActivity =
          goalFingerprints.size === 1 && exactKeys.size === 1 && Boolean(firstEvent.activityKey);
        const presentation = manualCorrectionPresentation(category, firstEvent);
        let remembered: { scope: 'page_goal' | 'exact' | 'none'; label?: string } = {
          scope: 'none',
        };

        if (input.rememberExactMatch && isOneBrowserPage) {
          const pageCorrectionKey = [...pageCorrectionKeys][0];
          let existingRule = await ActivityCorrectionRuleModel.findOne({
            userId,
            pageCorrectionKey,
            goalContextFingerprint: sharedGoalContext,
          }).lean();
          if (!existingRule && firstEvent.activityKey) {
            existingRule = await ActivityCorrectionRuleModel.findOne({
              userId,
              activityKey: firstEvent.activityKey,
              goalContextFingerprint: sharedGoalContext,
            }).lean();
          }
          await ActivityCorrectionRuleModel.findOneAndUpdate(
            existingRule
              ? { _id: existingRule._id }
              : { userId, pageCorrectionKey, goalContextFingerprint: sharedGoalContext },
            {
              $set: {
                // Keep a page rule's original exact key. Replacing it with a
                // new OCR-derived key could collide with a retained legacy
                // exact rule; page matching already covers the new visit.
                ...(existingRule?.pageCorrectionKey ? {} : { activityKey: firstEvent.activityKey }),
                pageCorrectionKey,
                categoryId: input.newCategoryId,
                activityLabel: presentation.activityLabel || null,
                // AI prose is never a durable correction. It may mention an
                // older focus session and would be misleading on a revisit.
                activitySummary: null,
                goalContextFingerprint: sharedGoalContext,
              },
            },
            { upsert: !existingRule, new: true }
          );
          remembered = { scope: 'page_goal', label: presentation.activityLabel || undefined };
        } else if (input.rememberExactMatch && isOneExactActivity) {
          await ActivityCorrectionRuleModel.findOneAndUpdate(
            {
              userId,
              activityKey: firstEvent.activityKey,
              goalContextFingerprint: sharedGoalContext,
            },
            {
              $set: {
                categoryId: input.newCategoryId,
                activityLabel: presentation.activityLabel || null,
                activitySummary: null,
                goalContextFingerprint: sharedGoalContext,
              },
            },
            { upsert: true, new: true }
          );
          remembered = { scope: 'exact', label: presentation.activityLabel || undefined };
        }

        return {
          success: true,
          updatedCount: updateResult.modifiedCount,
          remembered,
          learning: {
            status: learned.created ? ('created' as const) : ('skipped' as const),
            label: firstEvent.learningToolLabel || null,
            goal: null,
            scope: learned.scope,
            reasons: learned.reasons,
          },
        };
      } catch (error) {
        console.error('[EventsRouter] Error updating event categories: details withheld to protect activity context.');
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update the selected activity block.',
        });
      }
    }),

  getRememberedCorrections: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const decoded = verifyToken(input.token);
      const userId = decoded.userId;
      const [rules, categories] = await Promise.all([
        ActivityCorrectionRuleModel.find({ userId })
          .select('_id categoryId pageCorrectionKey activityLabel updatedAt')
          .sort({ updatedAt: -1 })
          .lean(),
        CategoryModel.find({ userId }).select('_id name color').lean(),
      ]);
      const categoriesById = new Map(
        categories.map((category) => [category._id.toString(), category])
      );
      // Deliberately return labels and category details only. Rule fingerprints
      // and effective goal fingerprints remain internal opaque identifiers.
      return rules.map((rule) => {
        const category = categoriesById.get(rule.categoryId);
        return {
          id: rule._id.toString(),
          label: rule.activityLabel || 'Remembered activity',
          scope: rule.pageCorrectionKey ? ('page_goal' as const) : ('exact' as const),
          categoryName: category?.name || 'Unavailable category',
          categoryColor: category?.color || null,
          updatedAt: rule.updatedAt.getTime(),
        };
      });
    }),

  removeRememberedCorrection: publicProcedure
    .input(
      z.object({
        token: z.string(),
        id: z.string().refine((value) => mongoose.Types.ObjectId.isValid(value)),
      })
    )
    .mutation(async ({ input }) => {
      const decoded = verifyToken(input.token);
      const result = await ActivityCorrectionRuleModel.deleteOne({
        _id: input.id,
        userId: decoded.userId,
      });
      if (result.deletedCount !== 1) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Remembered correction not found.' });
      }
      return { success: true, id: input.id };
    }),

  clearRememberedCorrections: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      const decoded = verifyToken(input.token);
      const result = await ActivityCorrectionRuleModel.deleteMany({ userId: decoded.userId });
      return { success: true, removedCount: result.deletedCount };
    }),

  getLearnedCorrectionPatterns: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const decoded = verifyToken(input.token);
      const examples = await ClassifierFeedbackModel.find({
        userId: decoded.userId,
        learningEligible: true,
      })
        .select(
          'learningPatternKey learningToolKey learningToolLabel learnedState goalSubjectCues activityPageKind activitySupportingMode updatedAt'
        )
        .sort({ updatedAt: -1 })
        .lean();
      const groups = new Map<string, (typeof examples)[number][]>();
      for (const example of examples) {
        const key = example.learningPatternKey || String(example._id);
        groups.set(key, [...(groups.get(key) || []), example]);
      }
      return [...groups.entries()].map(([id, records]) => {
        const first = records[0];
        const hasConflict = examples.some(
          (other) =>
            other.learningToolKey === first.learningToolKey &&
            other.activityPageKind === first.activityPageKind &&
            other.activitySupportingMode === first.activitySupportingMode &&
            other.learnedState !== first.learnedState
        );
        return {
          id,
          toolLabel: first.learningToolLabel || 'Remembered tool',
          state: first.learnedState === 'focused' ? ('focused' as const) : ('distracted' as const),
          goalCues: (first.goalSubjectCues || []).slice(0, 3),
          exampleCount: records.length,
          conflicted: hasConflict,
          updatedAt: first.updatedAt.getTime(),
        };
      });
    }),

  removeLearnedCorrectionPattern: publicProcedure
    .input(z.object({ token: z.string(), id: z.string().regex(/^[a-f0-9]{64}$/) }))
    .mutation(async ({ input }) => {
      const decoded = verifyToken(input.token);
      const result = await ClassifierFeedbackModel.deleteMany({
        userId: decoded.userId,
        learningEligible: true,
        learningPatternKey: input.id,
      });
      if (!result.deletedCount) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Learned pattern not found.' });
      }
      await UserModel.updateOne(
        { _id: decoded.userId },
        { $inc: { classificationLearningRevision: 1 } }
      );
      return { success: true, removedCount: result.deletedCount };
    }),

  clearLearnedCorrectionPatterns: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      const decoded = verifyToken(input.token);
      const result = await ClassifierFeedbackModel.deleteMany({
        userId: decoded.userId,
        learningEligible: true,
      });
      await CorrectionActionModel.updateMany(
        { userId: decoded.userId },
        { $set: { superseded: true, forgotten: true } }
      );
      await PreferenceControlModel.deleteMany({ userId: decoded.userId });
      {
        await UserModel.updateOne(
          { _id: decoded.userId },
          { $inc: { classificationLearningRevision: 1 } }
        );
      }
      return { success: true, removedCount: result.deletedCount };
    }),

  getClassificationHealth: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const decoded = verifyToken(input.token);
      const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const [events, feedback] = await Promise.all([
        ActiveWindowEventModel.find({
          userId: decoded.userId,
          timestamp: { $gte: since },
          type: { $ne: 'system' },
        })
          .select('classificationStatus contentSource classificationLatencyMs categoryId')
          .lean(),
        ClassifierFeedbackModel.find({
          userId: decoded.userId,
          createdAt: { $gte: new Date(since) },
        })
          .select('originalState learnedState learningEligible')
          .lean(),
      ]);
      const total = events.length;
      const technicalFailures = events.filter((event) =>
        ['invalid_response', 'ollama_unavailable', 'ocr_unavailable'].includes(
          String(event.classificationStatus || '')
        )
      ).length;
      const latencies = events
        .map((event) => Number(event.classificationLatencyMs))
        .filter((value) => Number.isFinite(value) && value >= 0)
        .sort((left, right) => left - right);
      const percentile = (fraction: number) =>
        latencies.length
          ? latencies[Math.min(latencies.length - 1, Math.floor((latencies.length - 1) * fraction))]
          : null;
      const sourceCounts = { dom: 0, ocr: 0, title: 0 };
      for (const event of events) {
        const source = event.contentSource;
        if (source === 'dom' || source === 'ocr' || source === 'title') sourceCounts[source] += 1;
      }
      const cacheHits = events.filter((event) =>
        ['history', 'navigation_cache', 'manual_rule'].includes(
          String(event.classificationStatus || '')
        )
      ).length;
      const reviews = await ClassificationReviewSampleModel.aggregate([
        {
          $match: {
            userId: decoded.userId,
            reviewedAtMs: { $gte: since },
            label: { $in: ['focused', 'distracted', 'unsure'] },
          },
        },
        {
          $group: {
            _id: '$stratum',
            related: { $sum: { $cond: [{ $eq: ['$label', 'focused'] }, 1, 0] } },
            offTask: { $sum: { $cond: [{ $eq: ['$label', 'distracted'] }, 1, 0] } },
            unsure: { $sum: { $cond: [{ $eq: ['$label', 'unsure'] }, 1, 0] } },
          },
        },
      ]);
      return {
        productiveReviewsByStratum: reviews.map((r) => ({
          stratum: r._id as string,
          related: r.related as number,
          offTask: r.offTask as number,
          unsure: r.unsure as number,
        })),
        technicalSuccessRate: total ? (total - technicalFailures) / total : null,
        semanticUncertainty: events.filter((e) => e.classificationStatus === 'insufficient_context')
          .length,
        periodDays: 7,
        total,
        successRate: total ? (total - technicalFailures) / total : null,
        technicalFailures,
        corrections: feedback.length,
        positiveCorrections: feedback.filter(
          (item) => item.originalState === 'distracted' && item.learnedState === 'focused'
        ).length,
        negativeCorrections: feedback.filter(
          (item) => item.originalState === 'focused' && item.learnedState === 'distracted'
        ).length,
        sourceCounts,
        cacheHitRate: total ? cacheHits / total : null,
        medianLatencyMs: percentile(0.5),
        p95LatencyMs: percentile(0.95),
      };
    }),
});
