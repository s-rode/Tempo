import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },
  name: {
    type: String,
    required: true,
  },
  googleId: {
    type: String,
    required: true,
    unique: true,
  },
  picture: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  hasSubscription: { type: Boolean, default: false },
  stripeCustomerId: { type: String },
  exportActionUsageCount: { type: Number, default: 0 },
  hasCompletedOnboarding: { type: Boolean, default: false },
  // Waitlist form data
  waitlistData: {
    firstName: { type: String },
    lastName: { type: String },
    jobTitle: { type: String },
    companyName: { type: String },
    workEmail: { type: String },
    useCase: { type: String },
    competitorExperience: { type: String },
    submittedAt: { type: Date },
  },
  isWaitlisted: { type: Boolean, default: false },
  tokenVersion: {
    type: Number,
    default: 0,
  },
  // Incremented only when explicit correction-learning examples or their
  // application setting change. It safely invalidates automatic history.
  classificationLearningMigrationVersion: { type: Number, default: 0 },
  classificationLearningRevision: { type: Number, default: 0, min: 0 },
  electronAppSettings: {
    calendarZoomLevel: {
      type: Number,
      default: 60, // Default hour height in pixels
      min: 40,
      max: 120,
    },
    theme: {
      type: String,
      default: 'system',
      enum: ['light', 'dark', 'system'],
    },
    playDistractionSound: {
      type: Boolean,
      default: true,
    },
    distractionSoundInterval: {
      type: Number,
      default: 30, // in seconds
    },
    showDistractionNotifications: {
      type: Boolean,
      default: true,
    },
    showDistractionNotchAlerts: {
      type: Boolean,
      default: true,
    },
    distractionNotificationInterval: {
      type: Number,
      default: 60, // in seconds
      min: 60,
    },
    notchTimerMode: {
      type: String,
      enum: ['streak', 'workday'],
      default: 'streak',
    },
    animateNotchTimerDigits: { type: Boolean, default: false },
    sessionTransitionAlerts: { type: Boolean, default: true },
    playSessionTransitionChime: { type: Boolean, default: true },
    workdayTimerResetAtMs: { type: Number, default: null },
    focusComparisonMode: {
      type: String,
      enum: ['all_active_days', 'same_day_type', 'same_weekday'],
      default: 'all_active_days',
    },
    aiTimelineSummaries: { type: Boolean, default: true },
    classifierStrictness: {
      type: String,
      enum: ['flexible', 'balanced', 'strict'],
      // Preserve the evidence gate used by existing Tempo installations.
      default: 'strict',
    },
    learnFromCorrections: { type: Boolean, default: true },
  },
  userGoals: {
    weeklyGoal: {
      type: String,
      default: '',
    },
    dailyGoal: {
      type: String,
      default: '',
    },
    lifeGoal: {
      type: String,
      default: '',
    },
  },
  // The inherited goal strings remain as a migration backup. New Tempo code
  // reads GoalPlan records instead, once this local migration is complete.
  goalPlanMigrationVersion: { type: Number, default: 0 },
});

export const User = mongoose.model('User', userSchema);
