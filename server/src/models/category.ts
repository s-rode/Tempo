import mongoose, { Document, Schema, Types } from 'mongoose';
import { Category as SharedCategory } from '../../../shared/types'; // Alias for clarity

// Interface for the Mongoose document, reflecting stored types
export interface ICategoryDoc extends Document {
  _id: Types.ObjectId; // Explicitly define _id as Mongoose uses it
  userId: Types.ObjectId; // Stored as ObjectId for ref
  name: SharedCategory['name'];
  description?: SharedCategory['description'];
  color: SharedCategory['color'];
  isProductive: SharedCategory['isProductive'];
  createdAt: Date; // from timestamps
  updatedAt: Date; // from timestamps
}

const categorySchema: Schema = new Schema<ICategoryDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // Matches ICategoryDoc.userId
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500 },
    color: {
      type: String,
      required: true,
      trim: true,
      default: '#FFFFFF',
      validate: {
        validator: function (v: string) {
          return /^#[0-9A-F]{6}$/i.test(v);
        },
        message: (props: any) => `${props.value} is not a valid hex color!`,
      },
    },
    isProductive: { type: Boolean, required: true, default: true },
  },
  {
    timestamps: true,
    toJSON: {
      // virtuals: true, // Not strictly needed if we manually handle _id and don't rely on virtual 'id'
      transform: function (doc: ICategoryDoc, ret) {
        ret._id = doc._id.toString();
        ret.userId = doc.userId.toString();
        delete ret.__v; // Remove version key
        delete ret.id; // Remove Mongoose's default virtual 'id' if it appears
        return ret;
      },
    },
    toObject: {
      // Keep toObject consistent for simplicity, though toJSON is usually primary for APIs
      // virtuals: true,
      transform: function (doc: ICategoryDoc, ret) {
        ret._id = doc._id.toString();
        ret.userId = doc.userId.toString();
        delete ret.__v;
        delete ret.id;
        return ret;
      },
    },
  }
);

// Index for unique category name per user
categorySchema.index({ userId: 1, name: 1 }, { unique: true });

export const CategoryModel = mongoose.model<ICategoryDoc>('Category', categorySchema);
