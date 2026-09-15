import mongoose, { Schema } from 'mongoose';

const todayPlanTaskSchema = new Schema(
  {
    taskId: { type: String, required: true },
    dateKey: { type: String, required: true },
  },
  { _id: false }
);

const focusGoalHistorySchema = new Schema(
  {
    goal: { type: String, required: true },
    todayPlanTask: { type: todayPlanTaskSchema, default: null },
    startedAtMs: { type: Number, required: true },
  },
  { _id: false }
);

const focusPhaseSchema = new Schema(
  {
    id: { type: String, required: true },
    kind: { type: String, required: true, enum: ['work', 'short_break', 'long_break'] },
    goal: { type: String, default: null },
    // The task identity is a provenance hint only. `goal` is the active
    // segment snapshot, so later plan edits cannot rewrite focus history.
    todayPlanTask: { type: todayPlanTaskSchema, default: null },
    // A phase may deliberately change its working goal without resetting its
    // clock. Keep the boundary records so the timeline remains historically
    // honest instead of applying the latest goal to the whole phase.
    goalHistory: { type: [focusGoalHistorySchema], default: [] },
    startedAtMs: { type: Number, default: null },
    completedAtMs: { type: Number, default: null },
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
    manualPausedAtMs: { type: Number, default: null },
    systemLocked: { type: Boolean, default: false },
    systemSleeping: { type: Boolean, default: false },
    systemSuspendedAtMs: { type: Number, default: null },
    awaitingSystemResumeCapture: { type: Boolean, default: false },
    transitionNotice: {
      id: { type: String, default: null },
      kind: {
        type: String,
        enum: ['focus_complete', 'break_started', 'break_complete', 'pomodoro_complete'],
        default: null,
      },
      runId: { type: String, default: null },
      phaseId: { type: String, default: null },
      phaseIndex: { type: Number, default: null },
      occurredAtMs: { type: Number, default: null },
      goal: { type: String, default: null },
      breakDurationMs: { type: Number, default: null },
    },
    acknowledgedTransitionNoticeId: { type: String, default: null },
    // A renderer heartbeat prevents an unexpected app shutdown from being
    // interpreted as uninterrupted focus time at the next launch.
    lastHeartbeatAtMs: { type: Number, default: null },
    revision: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const FocusRuntimeModel = mongoose.model('FocusRuntime', focusRuntimeSchema);

// Completed runs are deliberately separate from the one active runtime record.
// This makes a day of focus sessions available to the timeline without keeping
// stale phases alive in the live state machine.
export const FocusRunHistoryModel = mongoose.model(
  'FocusRunHistory',
  new Schema(
    {
      userId: { type: String, required: true, index: true },
      runId: { type: String, required: true, unique: true },
      run: { type: focusRunSchema, required: true },
      endedAtMs: { type: Number, required: true, index: true },
      outcome: { type: String, required: true, enum: ['completed', 'cancelled'] },
    },
    { timestamps: true }
  )
);
