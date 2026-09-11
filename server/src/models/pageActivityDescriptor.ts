import mongoose, { Document, Schema } from 'mongoose';
import { PAGE_KINDS } from '../services/categorization/pageDescriptorTypes';

export interface IPageActivityDescriptor extends Document {
  userId: string;
  activityKey: string;
  policyVersion: string;
  pageKind: string;
  actionLabel: string;
  topicCues: string[];
  evidenceQuality: 'strong' | 'partial' | 'weak';
  source: 'dom' | 'ocr' | 'title';
  revision: string;
}

const schema = new Schema<IPageActivityDescriptor>(
  {
    userId: { type: String, required: true, index: true },
    activityKey: { type: String, required: true, index: true },
    policyVersion: { type: String, required: true },
    pageKind: { type: String, enum: PAGE_KINDS, required: true },
    actionLabel: { type: String, maxlength: 60, required: true },
    topicCues: { type: [String], default: [] },
    evidenceQuality: { type: String, enum: ['strong', 'partial', 'weak'], required: true },
    source: { type: String, enum: ['dom', 'ocr', 'title'], required: true },
    revision: { type: String, required: true },
  },
  { timestamps: true }
);

schema.index({ userId: 1, activityKey: 1, policyVersion: 1 }, { unique: true });

export const PageActivityDescriptorModel = mongoose.model<IPageActivityDescriptor>(
  'PageActivityDescriptor',
  schema
);
