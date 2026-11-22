import mongoose from 'mongoose';

export const REPEAT_RULES = ['daily', 'weekdays', 'weekly'] as const;
export type RepeatRule = (typeof REPEAT_RULES)[number];

/**
 * A planner task that comes back on its own, such as daily flashcards. Each
 * day it applies to gets one task of its own (linked by `routineId`), added
 * when that day becomes today. `startDateKey` is the first day and, for a
 * weekly repeat, sets the weekday.
 */
const plannerRoutineSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    id: { type: String, required: true },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    goalId: { type: String, default: null },
    estimatedMinutes: { type: Number, default: null, min: 1, max: 720 },
    repeat: { type: String, required: true, enum: REPEAT_RULES },
    startDateKey: { type: String, required: true },
    // The last day a task was added for, so a deleted one doesn't come back.
    lastAddedDateKey: { type: String, required: true },
  },
  { timestamps: true }
);

plannerRoutineSchema.index({ userId: 1, id: 1 }, { unique: true });

export interface PlannerRoutine {
  id: string;
  text: string;
  goalId: string | null;
  estimatedMinutes: number | null;
  repeat: RepeatRule;
  startDateKey: string;
  lastAddedDateKey: string;
}

export const PlannerRoutineModel = mongoose.model('PlannerRoutine', plannerRoutineSchema);
