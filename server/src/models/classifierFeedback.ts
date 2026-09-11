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
  },
  { timestamps: true }
);

schema.index({ userId: 1, sourceEventId: 1 }, { unique: true });

export const ClassifierFeedbackModel = mongoose.model<IClassifierFeedback>(
  'ClassifierFeedback',
  schema
);
