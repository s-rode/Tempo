import mongoose, { Document, Schema } from 'mongoose';

export interface IClassifierFeedback extends Document {
  userId: string;
  sourceEventId: string;
  pageDescriptorRevision: string | null;
  effectiveGoalRef: string | null;
  originalCategoryId: string | null;
  correctedCategoryId: string;
  originalState: 'focused' | 'distracted' | 'uncertain';
  classifierVersion: string;
  /** New records only. Existing feedback stays evaluation-only. */
  learningEligible: boolean;
  learningPatternKey: string | null;
  learningToolKey: string | null;
  learningToolKind: 'app' | 'site' | null;
  learningToolLabel: string | null;
  learnedState: 'focused' | 'distracted' | null;
  learningGoalRef: string | null;
  goalSubjectCues: string[];
  goalExpectedOutcome: string;
  goalSupportingModes: string[];
  activityPageKind: string | null;
  activitySupportingMode: string | null;
  activityTopicCues: string[];
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IClassifierFeedback>(
  {
    userId: { type: String, required: true, index: true },
    sourceEventId: { type: String, required: true },
    pageDescriptorRevision: { type: String, default: null },
    effectiveGoalRef: { type: String, default: null },
    originalCategoryId: { type: String, default: null },
    correctedCategoryId: { type: String, required: true },
    originalState: {
      type: String,
      enum: ['focused', 'distracted', 'uncertain'],
      required: true,
    },
    classifierVersion: { type: String, required: true },
    learningEligible: { type: Boolean, default: false, index: true },
    learningPatternKey: { type: String, default: null, index: true },
    learningToolKey: { type: String, default: null, index: true },
    learningToolKind: { type: String, enum: ['app', 'site', null], default: null },
    learningToolLabel: { type: String, maxlength: 80, default: null },
    learnedState: { type: String, enum: ['focused', 'distracted', null], default: null },
    learningGoalRef: { type: String, default: null },
    goalSubjectCues: { type: [String], default: [] },
    goalExpectedOutcome: { type: String, maxlength: 120, default: '' },
    goalSupportingModes: { type: [String], default: [] },
    activityPageKind: { type: String, default: null },
    activitySupportingMode: { type: String, default: null },
    activityTopicCues: { type: [String], default: [] },
  },
  { timestamps: true }
);

schema.index({ userId: 1, sourceEventId: 1 }, { unique: true });
schema.index({ userId: 1, learningToolKey: 1, learningEligible: 1, updatedAt: -1 });
schema.index({ userId: 1, learningPatternKey: 1 });

export const ClassifierFeedbackModel = mongoose.model<IClassifierFeedback>(
  'ClassifierFeedback',
  schema
);
