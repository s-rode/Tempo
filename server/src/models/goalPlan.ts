import mongoose from 'mongoose';

const goalTaskSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    estimatedMinutes: { type: Number, default: null, min: 1, max: 720 },
    position: { type: Number, required: true, min: 0 },
    completedAtMs: { type: Number, default: null },
  },
  { _id: false }
);

/**
 * A small, local planning record. Daily and weekly records are bound to a
 * local calendar key, so they naturally become historical when their period
 * changes without a background reset job.
 */
const goalPlanSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    scope: { type: String, required: true, enum: ['daily', 'weekly', 'direction'] },
    // YYYY-MM-DD for daily and Monday-based weekly records; "current" for direction.
    periodKey: { type: String, required: true },
    timeZone: { type: String, required: true },
    tasks: { type: [goalTaskSchema], default: [] },
    // `text` is retained for historical/migration compatibility. New weekly
    // plans use a positive focus plus an optional ambiguity-only guardrail.
    focusText: { type: String, default: '', trim: true, maxlength: 1000 },
    attentionGuardrail: { type: String, default: '', trim: true, maxlength: 1000 },
    /** A quiet one-time prompt to review a weekly goal imported from legacy text. */
    focusReviewPending: { type: Boolean, default: false },
    text: { type: String, default: '', trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

goalPlanSchema.index({ userId: 1, scope: 1, periodKey: 1 }, { unique: true });

export interface GoalTask {
  id: string;
  text: string;
  estimatedMinutes?: number | null;
  position: number;
  completedAtMs: number | null;
}

export const GoalPlanModel = mongoose.model('GoalPlan', goalPlanSchema);
