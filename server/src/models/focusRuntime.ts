import mongoose, { Schema } from 'mongoose';

const focusPhaseSchema = new Schema(
  {
    id: { type: String, required: true },
    kind: { type: String, required: true, enum: ['work', 'short_break', 'long_break'] },
    goal: { type: String, default: null },
    startedAtMs: { type: Number, default: null },
    plannedDurationMs: { type: Number, required: true },
    activeElapsedMs: { type: Number, default: 0 },
    runningSinceMs: { type: Number, default: null },
    state: {
      type: String,
      required: true,
      enum: ['awaiting_goal', 'running', 'suspended', 'completed'],
    },
    productiveMs: { type: Number, default: 0 },
    distractedMs: { type: Number, default: 0 },
  },
  { _id: false }
);

const focusRunSchema = new Schema(
  {
    id: { type: String, required: true },
    kind: { type: String, required: true, enum: ['custom', 'pomodoro'] },
    state: { type: String, required: true, enum: ['active', 'completed', 'cancelled'] },
    currentPhaseIndex: { type: Number, required: true },
    phases: { type: [focusPhaseSchema], required: true },
    startedAtMs: { type: Number, required: true },
    completedAtMs: { type: Number, default: null },
  },
  { _id: false }
);

const focusRuntimeSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    run: { type: focusRunSchema, default: null },
    manualPauseUntilMs: { type: Number, default: null },
    systemLocked: { type: Boolean, default: false },
    systemSleeping: { type: Boolean, default: false },
    systemSuspendedAtMs: { type: Number, default: null },
    awaitingSystemResumeCapture: { type: Boolean, default: false },
    // A renderer heartbeat prevents an unexpected app shutdown from being
    // interpreted as uninterrupted focus time at the next launch.
    lastHeartbeatAtMs: { type: Number, default: null },
  },
  { timestamps: true }
);

export const FocusRuntimeModel = mongoose.model('FocusRuntime', focusRuntimeSchema);
