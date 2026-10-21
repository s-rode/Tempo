import mongoose, { Schema } from 'mongoose';
const schema = new Schema({
  userId: { type: String, required: true },
  key: { type: String, required: true },
  startedAtMs: Number,
});
schema.index({ userId: 1, key: 1 }, { unique: true });
/** Persist the start, not the latest capture, so cache hits and app restarts cannot renew navigation. */
export const NavigationEpisodeModel = mongoose.model('ClassificationNavigationEpisode', schema);
