import mongoose, { Schema } from 'mongoose';
import type { HistoricalGoalTarget } from '../../../shared/classification';

export interface CorrectionAction {
  actionId: string;
  rootActionId?: string;
  forgotten?: boolean;
  userId: string;
  eventIds: string[];
  source: 'correction' | 'review' | 'legacy';
  state: 'focused' | 'distracted';
  originalState: 'focused' | 'distracted' | 'uncertain';
  originalDecisions?: {
    eventId: string;
    categoryId: string | null;
    state: 'focused' | 'distracted' | 'uncertain';
  }[];
  toolKey: string;
  toolLabel: string;
  context: HistoricalGoalTarget;
  sessionId: string | null;
  supportingMode: string | null;
  occurredAtMs: number;
  superseded: boolean;
}

const schema = new Schema<CorrectionAction>({
  actionId: { type: String, required: true },
  rootActionId: { type: String },
  forgotten: { type: Boolean, default: false },
  userId: { type: String, required: true },
  eventIds: [String],
  source: { type: String, enum: ['correction', 'review', 'legacy'], required: true },
  state: { type: String, enum: ['focused', 'distracted'], required: true },
  originalState: { type: String, enum: ['focused', 'distracted', 'uncertain'], required: true },
  originalDecisions: {
    type: [
      {
        _id: false,
        eventId: { type: String, required: true },
        categoryId: { type: String, default: null },
        state: { type: String, enum: ['focused', 'distracted', 'uncertain'], required: true },
      },
    ],
    default: undefined,
  },
  toolKey: { type: String, required: true },
  toolLabel: { type: String, maxlength: 80 },
  context: { type: Schema.Types.Mixed, required: true },
  sessionId: { type: String, default: null },
  supportingMode: { type: String, default: null },
  occurredAtMs: { type: Number, required: true },
  superseded: { type: Boolean, default: false },
});
schema.index({ userId: 1, actionId: 1 }, { unique: true });
schema.index({ userId: 1, toolKey: 1, occurredAtMs: -1 });
export const CorrectionActionModel = mongoose.model<CorrectionAction>('CorrectionAction', schema);

// Explicit management is separate from evidence. Ordinary positive observations cannot clear a suspension.
const control = new Schema({
  userId: { type: String, required: true },
  preferenceId: { type: String, required: true },
  state: { type: String, enum: ['suspended', 'removed', 'active'], required: true },
  changedAtMs: { type: Number, required: true },
});
control.index({ userId: 1, preferenceId: 1 }, { unique: true });
export const PreferenceControlModel = mongoose.model('PreferenceControl', control);
