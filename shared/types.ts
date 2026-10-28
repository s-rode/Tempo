import type { PersonalizedEventMetadata } from './classification';
export type * from './classification';
export { clampDistractionSoundInterval, DISTRACTION_SOUNDS, DEFAULT_DISTRACTION_SOUND, resolveDistractionSound } from './distractionSound';
export type { DistractionSoundPermit, DistractionSoundId } from './distractionSound';

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string | null;
  hasSubscription?: boolean;
  stripeCustomerId?: string;
  isWaitlisted?: boolean;
  tokenVersion?: number;
  hasCompletedOnboarding?: boolean;
  electronAppSettings?: {
    distractionSound?: import('./distractionSound').DistractionSoundId;
    calendarZoomLevel?: number;
    sessionTransitionAlerts?: boolean;
    playSessionTransitionChime?: boolean;
    classifierStrictness?: ClassifierStrictness;
    /** Let explicit corrections inform similar local activity/goal decisions. */
    learnFromCorrections?: boolean;
  };
  userGoals?: {
    weeklyGoal: string;
    dailyGoal: string;
    lifeGoal: string;
  };
}

/** How much visible goal evidence Tempo needs before it calls activity focused. */
export type ClassifierStrictness = 'flexible' | 'balanced' | 'strict';

/** Shared transport bound for ephemeral browser evidence, measured in UTF-16 code units. */
export const MAX_ACTIVITY_CONTENT_CHARACTERS = 6500;

export interface ActiveWindowDetails {
  windowId?: number;
  ownerName: string;
  type: 'window' | 'browser' | 'system';
  browser?: 'chrome' | 'safari' | 'firefox' | null;
  title: string;
  url?: string | null;
  content?: string | null;
  timestamp?: number;
  localScreenshotPath?: string | null;
  screenshotS3Url?: string | null;
  captureReason?:
    | 'app_switch'
    | 'periodic_backup'
    | 'firefox_activation'
    | 'firefox_tab_switch'
    | 'system_lock'
    | 'system_unlock'
    | 'system_sleep'
    | 'system_wake'
    | 'system_lock_initial'
    | null;
  contentSource?: 'dom' | 'ocr' | 'title' | null;
  /** Ephemeral Firefox hostname used only during local classification. Never persisted. */
  siteHost?: string | null;
  contentCaptureStatus?:
    | 'captured'
    | 'permission_denied'
    | 'capture_failed'
    | 'no_text'
    | 'navigation_pending'
    | null;
  navigationFingerprint?: string | null;
  /** Opaque, per-install fingerprint for a browser page. Never contains a URL. */
  pageCorrectionKey?: string | null;
  /** Opaque site identity retained across captures; contains no hostname or page text. */
  siteIdentity?: string | null;
  activityKey?: string | null;
  activityLabel?: string | null;
  activitySummary?: string | null;
  categoryReasoning?: string | null;
  nudgeVersion?: string | null;
  nudgeTitle?: string | null;
  nudgeBody?: string | null;
  /** Opaque delivery ID used only to make foreground-capture retries idempotent. */
  monitoringCaptureId?: string;
  monitoringSequence?: number;
}

export interface ActiveWindowEvent extends ActiveWindowDetails, PersonalizedEventMetadata {
  eventId?: string;
  userId: string;
  categoryId?: string | null;
  categoryReasoning?: string | null;
  classificationStatus?:
    | 'history'
    | 'navigation_cache'
    | 'deterministic_direct'
    | 'ollama'
    | 'manual'
    | 'manual_rule'
    | 'policy_override'
    | 'ollama_unavailable'
    | 'invalid_response'
    | 'ocr_unavailable'
    | 'insufficient_context';
  contentFingerprint?: string | null;
  goalContextFingerprint?: string | null;
  /** Includes the active relation-policy/profile revision for safe cache reuse. */
  classificationContextFingerprint?: string | null;
  /** Evidence relation used for this one event; never contains captured content. */
  goalRelation?: 'direct' | 'supporting' | 'none' | 'insufficient' | null;
  supportingMode?: string | null;
  /** Privacy-safe local model diagnostics. Never contains activity content. */
  classificationFailureCode?:
    | 'empty_model_output'
    | 'invalid_json'
    | 'invalid_decision_shape'
    | 'unknown_category'
    | 'core_retry_exhausted'
    | 'timeout'
    | 'ollama_http_error'
    | 'enrichment_failed'
    | null;
  classificationAttemptCount?: number;
  /** Bounded derived metadata only; never contains page text, hostname, URL, or model output. */
  pageDescriptorRevision?: string | null;
  pageKind?: string | null;
  /** Bounded derived descriptor cues, never raw page text. */
  pageDescriptorTopicCues?: string[] | null;
  evidenceQuality?: 'strong' | 'partial' | 'weak' | null;
  decisionConfidence?: 'high' | 'medium' | 'low' | null;
  matchedGoalRef?: string | null;
  classificationLatencyMs?: number | null;
  /** The local evidence policy that resolved this newly recorded event. */
  classifierStrictness?: ClassifierStrictness;
  /** Opaque learning metadata only; browser hostnames and activity content are never stored. */
  learningToolKey?: string | null;
  learningToolKind?: 'app' | 'site' | null;
  learningToolLabel?: string | null;
  learningExampleId?: string | null;
}

export interface Category {
  _id: string;
  userId: string;
  name: string;
  description?: string;
  color: string; // Hex color code, e.g., "#FF5733"
  isProductive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type FocusRunKind = 'custom' | 'pomodoro';
export type FocusPhaseKind = 'work' | 'short_break' | 'long_break';
export type FocusPhaseState = 'awaiting_goal' | 'running' | 'suspended' | 'completed';
export type FocusTransitionNoticeKind =
  | 'focus_complete'
  | 'break_started'
  | 'break_complete'
  | 'pomodoro_complete';

/** A one-shot, persisted delivery record for a naturally completed focus phase. */
export interface FocusTransitionNotice {
  id: string;
  kind: FocusTransitionNoticeKind;
  runId: string;
  phaseId: string;
  phaseIndex: number;
  occurredAtMs: number;
  /** The completed work goal when it is useful to name the transition. */
  goal: string | null;
  /** The scheduled break duration, when the next action is to take a break. */
  breakDurationMs: number | null;
}
export type SuspensionReason =
  | 'calendar_event'
  | 'manual_pause'
  | 'pomodoro_break'
  | 'long_break'
  | 'awaiting_goal'
  | 'screen_locked'
  | 'system_sleep';

export interface FocusPhase {
  id: string;
  kind: FocusPhaseKind;
  goal: string | null;
  /** The Today’s Plan task that supplied the current goal, if any. */
  todayPlanTask?: import('./reminders').FocusTaskSource | null;
  /**
   * Goal changes made while a work phase is running. This preserves the
   * original goal for the earlier part of a phase without restarting its timer.
   */
  goalHistory?: Array<{
    goal: string;
    todayPlanTask: import('./reminders').FocusTaskSource | null;
    startedAtMs: number;
  }>;
  /** Wall-clock boundary for events belonging to this phase. Null until a phase starts. */
  startedAtMs: number | null;
  /** Wall-clock boundary recorded when this phase finishes. */
  completedAtMs?: number | null;
  plannedDurationMs: number;
  activeElapsedMs: number;
  runningSinceMs: number | null;
  state: FocusPhaseState;
  productiveMs: number;
  distractedMs: number;
}

export interface FocusRun {
  id: string;
  kind: FocusRunKind;
  state: 'active' | 'completed' | 'cancelled';
  currentPhaseIndex: number;
  phases: FocusPhase[];
  startedAtMs: number;
  completedAtMs?: number | null;
}

export interface FocusRuntimeSnapshot {
  mode: FocusRunKind | 'normal';
  trackingState: 'normal' | 'active' | 'paused' | 'break';
  suspension: { reasons: SuspensionReason[]; pausedUntilMs: number | null };
  run: FocusRun | null;
  currentPhase: FocusPhase | null;
  phaseRemainingMs: number | null;
  /** Server-owned deadline for a currently running phase or manual pause. */
  nextDeadlineAtMs: number | null;
  /** Present until Tempo has attempted this notice's one-time delivery. */
  transitionNotice: FocusTransitionNotice | null;
}
/** Bump whenever a packaged local server must not be reused across app updates. */
export const TEMPO_LOCAL_SERVER_API_VERSION = '2026-10-tempo-local-calendar-v2';

export { usableDistractionNudge, type DistractionNudge } from './distractionNudge';
