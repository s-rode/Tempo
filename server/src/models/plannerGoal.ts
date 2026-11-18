import mongoose from 'mongoose';

/**
 * A long-term goal in Tempo's built-in planner. Planner tasks may point at one
 * goal by `id`; deleting a goal only clears that link, never the tasks.
 */
const plannerGoalSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    id: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    notes: { type: String, default: '', trim: true, maxlength: 2000 },
    color: { type: String, required: true },
    icon: { type: String, default: '', maxlength: 16 },
    position: { type: Number, required: true, min: 0 },
    completedAtMs: { type: Number, default: null },
  },
  { timestamps: true }
);

plannerGoalSchema.index({ userId: 1, id: 1 }, { unique: true });

export const PlannerGoalModel = mongoose.model('PlannerGoal', plannerGoalSchema);
