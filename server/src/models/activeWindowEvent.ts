import mongoose, { Document, Schema } from 'mongoose';
import { ActiveWindowEvent } from '../../../shared/types';

export interface IActiveWindowEvent extends ActiveWindowEvent, Document {}

const activeWindowEventSchema = new Schema({
  goalSnapshot: { type: Schema.Types.Mixed, default: null },
  classificationBasis: { type: String, default: null },
  semanticProposal: { type: Schema.Types.Mixed, default: null },
  preferenceId: { type: String, default: null },
  decisionExpiresAtMs: { type: Number, default: null },
  userId: { type: String, required: true, index: true },
  windowId: { type: Number, required: false }, // Made optional for system events
  ownerName: { type: String, required: true },
  type: { type: String, required: true, enum: ['window', 'browser', 'system'] }, // Added 'system' type
  browser: { type: String, enum: ['chrome', 'safari', 'firefox', null] },
  title: { type: String, required: false },
  // Raw URLs, hostnames, DOM text, and OCR text are deliberately not schema
  // fields. New classifier requests can use them transiently, but Mongoose
  // cannot persist them accidentally.
  contentSource: { type: String, enum: ['dom', 'ocr', 'title', null] },
  contentCaptureStatus: {
    type: String,
    enum: [
      'captured',
      'permission_denied',
      'capture_failed',
      'no_text',
      'navigation_pending',
      null,
    ],
  },
  contentFingerprint: { type: String, index: true },
  activityKey: { type: String, index: true },
  goalContextFingerprint: { type: String, index: true, default: null },
  classificationContextFingerprint: { type: String, index: true, default: null },
  goalRelation: {
    type: String,
    enum: ['direct', 'supporting', 'none', 'insufficient', null],
    default: null,
  },
  supportingMode: { type: String, default: null },
  navigationFingerprint: { type: String, index: true, default: null },
  pageCorrectionKey: { type: String, index: true, default: null },
  activityLabel: { type: String, maxlength: 60 },
  activitySummary: { type: String, maxlength: 120 },
  categoryId: { type: String, required: false, index: true },
  categoryReasoning: { type: String },
  nudgeVersion: { type: String, default: null },
  nudgeTitle: { type: String, maxlength: 80 },
  nudgeBody: { type: String, maxlength: 180 },
  classificationStatus: {
    type: String,
    enum: [
      'history',
      'navigation_cache',
      'deterministic_direct',
      'ollama',
      'manual',
      'manual_rule',
      'policy_override',
      'ollama_unavailable',
      'invalid_response',
      'ocr_unavailable',
      'insufficient_context',
    ],
  },
  classificationFailureCode: {
    type: String,
    enum: [
      'empty_model_output',
      'invalid_json',
      'invalid_decision_shape',
      'unknown_category',
      'core_retry_exhausted',
      'timeout',
      'ollama_http_error',
      'enrichment_failed',
      null,
    ],
    default: null,
  },
  classificationAttemptCount: { type: Number, min: 0, default: 0 },
  pageDescriptorRevision: { type: String, index: true, default: null },
  pageKind: { type: String, default: null },
  pageDescriptorTopicCues: { type: [String], default: [] },
  evidenceQuality: { type: String, enum: ['strong', 'partial', 'weak', null], default: null },
  decisionConfidence: { type: String, enum: ['high', 'medium', 'low', null], default: null },
  matchedGoalRef: { type: String, default: null },
  classificationLatencyMs: { type: Number, min: 0, default: null },
  classifierStrictness: {
    type: String,
    enum: ['flexible', 'balanced', 'strict', null],
    default: null,
  },
  // Opaque correction-learning identity. Browser hostnames never enter this
  // collection; Settings may show only the application label.
  learningToolKey: { type: String, index: true, default: null },
  learningToolKind: { type: String, enum: ['app', 'site', null], default: null },
  learningToolLabel: { type: String, maxlength: 80, default: null },
  learningExampleId: { type: String, default: null },
  // A foreground capture may be redelivered after a renderer/network failure.
  // The opaque ID makes retries return the first saved event rather than
  // repeating local inference or adding duplicate history.
  monitoringCaptureId: { type: String, default: null },
  timestamp: { type: Number, required: true, default: Date.now, index: true },
  screenshotS3Url: { type: String },
  captureReason: {
    type: String,
    enum: [
      'app_switch',
      'periodic_backup',
      'firefox_activation',
      'firefox_tab_switch',
      'system_lock',
      'system_unlock',
      'system_sleep',
      'system_wake',
      'system_lock_initial',
      null,
    ],
  },
});

// Compound index for efficient querying by userId and timestamp
activeWindowEventSchema.index({ userId: 1, timestamp: -1 });
activeWindowEventSchema.index(
  { userId: 1, monitoringCaptureId: 1 },
  { unique: true, partialFilterExpression: { monitoringCaptureId: { $type: 'string' } } }
);
activeWindowEventSchema.index({
  userId: 1,
  activityKey: 1,
  classificationContextFingerprint: 1,
  timestamp: -1,
});

export const ActiveWindowEventModel = mongoose.model<IActiveWindowEvent>(
  'ActiveWindowEvent',
  activeWindowEventSchema
);
