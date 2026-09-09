import mongoose, { Document, Schema } from 'mongoose';
import { SUPPORTING_MODES } from '../services/categorization/goalSupportTypes';

/**
 * A compact, local-only interpretation of a user-authored goal. It contains
 * no activity data: URLs, OCR, screenshots, prompts, and model prose never
 * enter this collection.
 */
export interface IGoalSupportProfile extends Document {
  userId: string;
  goalRef: string;
  goalTextFingerprint: string;
  policyVersion: number;
  subjectCues: string[];
  supportingModes: string[];
  revision: string;
  createdAt: Date;
  updatedAt: Date;
}

const goalSupportProfileSchema = new Schema<IGoalSupportProfile>(
  {
    userId: { type: String, required: true, index: true },
    goalRef: { type: String, required: true, index: true },
    goalTextFingerprint: { type: String, required: true, index: true },
    policyVersion: { type: Number, required: true },
    subjectCues: { type: [String], default: [] },
    supportingModes: { type: [String], enum: SUPPORTING_MODES, default: [] },
    revision: { type: String, required: true },
  },
  { timestamps: true }
);

goalSupportProfileSchema.index(
  { userId: 1, goalRef: 1, goalTextFingerprint: 1, policyVersion: 1 },
  { unique: true }
);

export const GoalSupportProfileModel = mongoose.model<IGoalSupportProfile>(
  'GoalSupportProfile',
  goalSupportProfileSchema
);
