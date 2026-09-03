import mongoose, { Document, Schema } from 'mongoose';

export interface IActivityCorrectionRule extends Document {
  userId: string;
  activityKey: string;
  goalContextFingerprint?: string | null;
  categoryId: string;
  activityLabel?: string | null;
  activitySummary?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const activityCorrectionRuleSchema = new Schema<IActivityCorrectionRule>(
  {
    userId: { type: String, required: true, index: true },
    activityKey: { type: String, required: true, index: true },
    goalContextFingerprint: { type: String, default: null, index: true },
    categoryId: { type: String, required: true },
    activityLabel: { type: String, maxlength: 60 },
    activitySummary: { type: String, maxlength: 120 },
  },
  { timestamps: true }
);

activityCorrectionRuleSchema.index({ userId: 1, activityKey: 1, goalContextFingerprint: 1 }, { unique: true });

export const ActivityCorrectionRuleModel = mongoose.model<IActivityCorrectionRule>(
  'ActivityCorrectionRule',
  activityCorrectionRuleSchema
);
