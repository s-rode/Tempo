import { useRelevanceCheck } from '../../hooks/useRelevanceCheck'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { EditIcon, ExternalLink, Play } from 'lucide-react'
import React, { JSX, useEffect, useMemo, useState } from 'react'
import { ActiveWindowEvent, Category } from 'shared'
import type { ActivityToRecategorize } from '../../App'
import { useAuth } from '../../contexts/AuthContext'
import { useDistractionNotification } from '../../hooks/useDistractionNotification'
import { useFocusTransitionAlerts } from '../../hooks/useFocusTransitionAlerts'
import { useDistractionSound } from '../../hooks/useDistractionSound'
import { useRecategorizationHandler } from '../../hooks/useRecategorizationHandler'
import {
  getCardBgColor,
  getDisplayWindowInfo,
  getStatusText,
  getStatusTextColor
} from '../../utils/distractionStatusBarUIHelpers'
import { calculateProductivityMetrics } from '../../utils/timeMetrics'
import { deriveFocusPhaseTimerState, deriveNotchTimerState } from '../../lib/notchTimerState'
import { getWorkdayRange, sameWorkdayRange } from '../../lib/workdayRange'
import { displayActivityLabel, displayActivitySummary } from '../../lib/activityPresentation'
import { currentActivityEvent, type ForegroundActivityWindow } from '../../lib/activityCaptureState'
import { trpc } from '../../utils/trpc'
import { ActivityIcon } from './ActivityIcon'
import { Button } from './button'
import DistractionStatusLoadingSkeleton from './DistractionStatusLoadingSkeleton'

interface DistractionStatusBarProps {
  activeWindow: ForegroundActivityWindow | null
  onOpenMiniTimerClick: () => void
  isMiniTimerVisible: boolean
  onOpenRecategorizeDialog: (target: ActivityToRecategorize) => void
  onSettingsClick: () => void
  isSettingsOpen: boolean
  // The server router is bundled separately, so keep this transport payload
  // structural rather than coupling this renderer build to its declaration file.
  focusRuntime?: any
  systemSuspension?: {
    locked: boolean
    sleeping: boolean
    suspendedAtMs: number | null
    awaitingFreshActivity: boolean
  }
  localPause?: { startedAtMs: number; untilMs: number } | null
  onResumeTracking: () => void
  onOpenFocusControls: () => void
  isResumingTracking: boolean
}

// Props comparison can be simplified or removed if activeWindow prop changes don't directly trigger new data fetching logic
// For now, let's keep it, but its role might change.
const arePropsEqual = (
  prevProps: DistractionStatusBarProps,
  nextProps: DistractionStatusBarProps
): boolean => {
  if (Boolean(prevProps.activeWindow) !== Boolean(nextProps.activeWindow)) return false
  const p = prevProps.activeWindow
  const n = nextProps.activeWindow
  const activityIsEqual =
    !p ||
    !n ||
    (p.ownerName === n.ownerName &&
      p.title === n.title &&
      p.url === n.url &&
      p.content === n.content && // Assuming content changes are also significant for display
      p.type === n.type &&
      p.browser === n.browser &&
      p.monitoringCaptureId === n.monitoringCaptureId &&
      p.classificationFailed === n.classificationFailed)
  return (
    activityIsEqual &&
    prevProps.isMiniTimerVisible === nextProps.isMiniTimerVisible &&
    prevProps.onOpenRecategorizeDialog === nextProps.onOpenRecategorizeDialog &&
    prevProps.onResumeTracking === nextProps.onResumeTracking &&
    prevProps.onOpenFocusControls === nextProps.onOpenFocusControls &&
    prevProps.isResumingTracking === nextProps.isResumingTracking &&
    prevProps.isSettingsOpen === nextProps.isSettingsOpen &&
    prevProps.focusRuntime?.revision === nextProps.focusRuntime?.revision &&
    prevProps.focusRuntime?.run?.id === nextProps.focusRuntime?.run?.id &&
    prevProps.focusRuntime?.run?.currentPhaseIndex ===
      nextProps.focusRuntime?.run?.currentPhaseIndex &&
    prevProps.focusRuntime?.currentPhase?.id === nextProps.focusRuntime?.currentPhase?.id &&
    prevProps.focusRuntime?.currentPhase?.startedAtMs ===
      nextProps.focusRuntime?.currentPhase?.startedAtMs &&
    prevProps.focusRuntime?.currentPhase?.goal === nextProps.focusRuntime?.currentPhase?.goal &&
    prevProps.focusRuntime?.trackingState === nextProps.focusRuntime?.trackingState &&
    prevProps.focusRuntime?.phaseRemainingMs === nextProps.focusRuntime?.phaseRemainingMs &&
    prevProps.focusRuntime?.transitionNotice?.id === nextProps.focusRuntime?.transitionNotice?.id &&
    prevProps.systemSuspension?.locked === nextProps.systemSuspension?.locked &&
    prevProps.systemSuspension?.sleeping === nextProps.systemSuspension?.sleeping &&
    prevProps.systemSuspension?.awaitingFreshActivity ===
      nextProps.systemSuspension?.awaitingFreshActivity &&
    prevProps.localPause?.untilMs === nextProps.localPause?.untilMs
  )
}

const DistractionStatusBar = ({
  activeWindow,
  onOpenMiniTimerClick,
  isMiniTimerVisible,
  onOpenRecategorizeDialog,
  onSettingsClick,
  isSettingsOpen,
  focusRuntime,
  systemSuspension,
  localPause,
  onResumeTracking,
  onOpenFocusControls,
  isResumingTracking
}: DistractionStatusBarProps): JSX.Element | null => {
  const { token } = useAuth()
  const [isNarrowView, setIsNarrowView] = useState(false)

  useEffect(() => {
    const handleResize = () => {
      setIsNarrowView(window.innerWidth < 800)
    }
    window.addEventListener('resize', handleResize)
    handleResize() // Initial check
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const { data: persistedLatestEvent, isLoading: isLoadingLatestEvent } =
    // note: make sure you invalidate the query when you create a new event, otherwise it will not be updated
    trpc.activeWindowEvents.getLatestEvent.useQuery(
      { token: token || '' },
      {
        enabled: !!token && typeof token === 'string' && token.length > 0,
        // Creation/reuse updates this cache directly. Recovery happens on
        // wake/window focus rather than a permanent database heartbeat.
        refetchOnWindowFocus: true
      }
    )

  const latestEvent = currentActivityEvent(persistedLatestEvent, activeWindow)
  const categoryId = latestEvent?.categoryId

  const { data: categoryDetails, isLoading: isLoadingCategory } =
    trpc.category.getCategoryById.useQuery(
      { token: token || '', categoryId: categoryId || '' },
      {
        enabled:
          !!token &&
          typeof token === 'string' &&
          token.length > 0 &&
          !!categoryId &&
          categoryId !== ''
      }
    )

  const { data: userCategories, isLoading: isLoadingUserCategories } =
    trpc.category.getCategories.useQuery(
      { token: token || '' },
      { enabled: !!token && typeof token === 'string' && token.length > 0 }
    )
  const { data: electronSettings } = trpc.user.getElectronAppSettings.useQuery(
    { token: token || '' },
    { enabled: !!token }
  )

  const [workdayRange, setWorkdayRange] = React.useState<ReturnType<typeof getWorkdayRange> | null>(
    null
  )

  React.useEffect(() => {
    let boundaryTimeout: number | undefined
    const updateWorkdayRange = () => {
      if (boundaryTimeout !== undefined) window.clearTimeout(boundaryTimeout)
      const nextRange = getWorkdayRange(Date.now(), electronSettings?.workdayTimerResetAtMs)
      setWorkdayRange((currentRange) =>
        sameWorkdayRange(currentRange, nextRange) ? currentRange : nextRange
      )
      // Calendar dates—not a recurring ten-second timer—are the only reason
      // this range changes. Date arithmetic keeps this correct across DST.
      boundaryTimeout = window.setTimeout(
        updateWorkdayRange,
        Math.max(250, nextRange.endDateMs - Date.now() + 50)
      )
    }

    const recoverAfterWakeOrVisibility = () => {
      if (document.visibilityState === 'visible') updateWorkdayRange()
    }

    updateWorkdayRange()
    window.addEventListener('focus', recoverAfterWakeOrVisibility)
    document.addEventListener('visibilitychange', recoverAfterWakeOrVisibility)

    return () => {
      if (boundaryTimeout !== undefined) window.clearTimeout(boundaryTimeout)
      window.removeEventListener('focus', recoverAfterWakeOrVisibility)
      document.removeEventListener('visibilitychange', recoverAfterWakeOrVisibility)
    }
  }, [electronSettings?.workdayTimerResetAtMs])

  // System sleep can defer a renderer timeout past 06:00. The state transition
  // and the first runtime reconciliation are authoritative wake signals, so
  // recompute the calendar range immediately rather than waiting for Chromium
  // to run the expired timeout. This is a pure comparison unless a boundary
  // actually changed and introduces no polling.
  React.useEffect(() => {
    if (systemSuspension?.locked || systemSuspension?.sleeping) return
    const nextRange = getWorkdayRange(Date.now(), electronSettings?.workdayTimerResetAtMs)
    setWorkdayRange((currentRange) =>
      sameWorkdayRange(currentRange, nextRange) ? currentRange : nextRange
    )
  }, [
    systemSuspension?.locked,
    systemSuspension?.sleeping,
    systemSuspension?.awaitingFreshActivity,
    focusRuntime?.revision,
    electronSettings?.workdayTimerResetAtMs
  ])

  const { data: todayEvents, isLoading: isLoadingTodayEvents } =
    trpc.activeWindowEvents.getEventsForDateRange.useQuery(
      {
        token: token || '',
        // React Query constructs this input before evaluating `enabled`, so
        // the first render must remain safe while the calendar range is being
        // initialized.
        startDateMs: workdayRange?.startDateMs ?? 0,
        endDateMs: workdayRange?.endDateMs ?? 0
      },
      {
        enabled: !!token && typeof token === 'string' && token.length > 0 && workdayRange !== null,
        refetchOnWindowFocus: true
      }
    )

  const runtimeSuspensionReasons: string[] = focusRuntime?.suspension?.reasons || []
  const runtimeHasStaleSystemSuspension = runtimeSuspensionReasons.some(
    (reason) => reason === 'screen_locked' || reason === 'system_sleep'
  )
  const runtimeAwaitingFreshActivity = runtimeSuspensionReasons.includes('awaiting_system_resume')
  const runtimeHasManualPause = runtimeSuspensionReasons.includes('manual_pause')
  const awaitingFreshActivity = Boolean(
    systemSuspension?.awaitingFreshActivity || runtimeAwaitingFreshActivity
  )
  // Once a real wake/unlock or the explicit recovery action has scheduled its
  // fresh capture, the persisted runtime can still contain the old lock/sleep
  // marker for one local round trip. The in-memory boundary is newer, so show
  // the honest “resuming” state instead of briefly regressing to “sleeping”.
  const runtimeSystemSuspensionIsAuthoritative =
    runtimeHasStaleSystemSuspension && !systemSuspension?.awaitingFreshActivity
  const isSystemSuspended = Boolean(
    systemSuspension?.locked ||
      systemSuspension?.sleeping ||
      awaitingFreshActivity ||
      runtimeSystemSuspensionIsAuthoritative
  )
  // The native event and persisted runtime normally agree. Reading both also
  // lets a user recover after Tempo itself was relaunched while macOS's wake
  // event was missing.
  const hasStaleSystemSuspension = Boolean(
    systemSuspension?.locked || systemSuspension?.sleeping || runtimeSystemSuspensionIsAuthoritative
  )
  // A manual pause can survive a stale sleep recovery. Do not present its
  // recovery control as a sleep-only action: it must actually clear the
  // persisted pause before asking the observer for fresh activity.
  const needsSystemResumeAction =
    !runtimeHasManualPause && (hasStaleSystemSuspension || awaitingFreshActivity)
  const isWaitingForPomodoroGoal = Boolean(
    focusRuntime?.run?.kind === 'pomodoro' && focusRuntime.currentPhase?.state === 'awaiting_goal'
  )
  const isLocallyPaused = Boolean(localPause && localPause.untilMs > Date.now())
  const trackingActive =
    !isSystemSuspended &&
    !isLocallyPaused &&
    (!focusRuntime ||
      focusRuntime.trackingState === 'active' ||
      focusRuntime.trackingState === 'normal')

  useDistractionSound(
    categoryDetails as Category | null | undefined,
    trackingActive,
    latestEvent?.classificationStatus
  )

  const displayWindowInfo = useMemo(
    () => getDisplayWindowInfo(latestEvent, activeWindow),
    [latestEvent, activeWindow]
  )

  useEffect(() => {
    if (
      (!latestEvent && !activeWindow) ||
      !userCategories ||
      !todayEvents ||
      !window.electron?.ipcRenderer
    ) {
      return
    }

    let latestStatus: 'productive' | 'unproductive' | 'maybe' = 'maybe'
    let categoryDetailsForFloatingWindow: Category | undefined = undefined

    if (categoryDetails && typeof categoryDetails === 'object' && '_id' in categoryDetails) {
      const fullCategoryDetails = categoryDetails as Category
      if (fullCategoryDetails.isProductive === true) latestStatus = 'productive'
      else if (fullCategoryDetails.isProductive === false) {
        latestStatus = 'unproductive'
      }
      categoryDetailsForFloatingWindow = fullCategoryDetails
    } else if (categoryDetails === null) {
      latestStatus = 'maybe'
      // No specific category to send for 'maybe' if it's due to category not found
      // Or we could send a generic "Uncategorized" message if desired
    }

    const { dailyProductiveMs, dailyUnproductiveMs } = calculateProductivityMetrics(
      todayEvents as ActiveWindowEvent[],
      userCategories as Category[]
    )
    const phaseStartedAtMs =
      focusRuntime?.currentPhase?.kind === 'work' ? focusRuntime.currentPhase.startedAtMs : null
    // Metrics already include the current event through this instant. Give the
    // helper that stable base and a live clock starting now; otherwise workday
    // totals only advance on the next activity/database refresh.
    const timerSampledAtMs = Date.now()
    const dailyProductiveClock = {
      accumulatedMs: dailyProductiveMs,
      runningSinceMs: trackingActive && latestStatus === 'productive' ? timerSampledAtMs : null
    }
    const dailyUnproductiveClock = {
      accumulatedMs: dailyUnproductiveMs,
      runningSinceMs: trackingActive && latestStatus === 'unproductive' ? timerSampledAtMs : null
    }
    const notchTimers =
      electronSettings?.notchTimerMode === 'workday'
        ? {
            productiveClock: {
              accumulatedMs: dailyProductiveMs,
              runningSinceMs:
                trackingActive && latestStatus === 'productive' ? timerSampledAtMs : null
            },
            distractedClock: {
              accumulatedMs: dailyUnproductiveMs,
              runningSinceMs:
                trackingActive && latestStatus === 'unproductive' ? timerSampledAtMs : null
            },
            provisionalDistractionStartedAtMs: null,
            productiveStreakMs: dailyProductiveMs,
            distractedStreakMs: dailyUnproductiveMs,
            statusStartedAtMs: timerSampledAtMs
          }
        : phaseStartedAtMs
          ? deriveFocusPhaseTimerState(
              todayEvents as ActiveWindowEvent[],
              userCategories as Category[],
              phaseStartedAtMs,
              dailyProductiveMs,
              dailyUnproductiveMs,
              trackingActive
            )
          : deriveNotchTimerState(
              todayEvents as ActiveWindowEvent[],
              userCategories as Category[],
              dailyProductiveMs,
              dailyUnproductiveMs
            )

    const itemType = displayWindowInfo.isApp ? 'app' : 'website'
    const activityName = displayActivityLabel({
      isProductive:
        latestStatus === 'productive' ? true : latestStatus === 'unproductive' ? false : undefined,
      ownerName: displayWindowInfo.ownerName,
      title: displayWindowInfo.title,
      activityLabel: latestEvent?.activityLabel
    })
    const activitySummary = displayActivitySummary({
      isProductive:
        latestStatus === 'productive' ? true : latestStatus === 'unproductive' ? false : undefined,
      activitySummary: latestEvent?.activitySummary,
      categoryReasoning: latestEvent?.categoryReasoning
    })

    window.electron.ipcRenderer.send('update-floating-window-status', {
      latestStatus,
      dailyProductiveMs,
      dailyUnproductiveMs,
      dailyProductiveClock,
      dailyUnproductiveClock,
      productiveClock: notchTimers.productiveClock,
      distractedClock: notchTimers.distractedClock,
      provisionalDistractionStartedAtMs: notchTimers.provisionalDistractionStartedAtMs,
      productiveStreakMs: notchTimers.productiveStreakMs,
      distractedStreakMs: notchTimers.distractedStreakMs,
      statusStartedAtMs: notchTimers.statusStartedAtMs,
      animateTimerDigits: electronSettings?.animateNotchTimerDigits === true,
      categoryDetails: categoryDetailsForFloatingWindow,
      availableCategories: userCategories as Category[],
      itemType,
      activitySource: displayWindowInfo.ownerName,
      activityName,
      activityUrl: displayWindowInfo.url,
      activitySummary,
      categoryReasoning: latestEvent?.categoryReasoning,
      classificationStatus:
        latestEvent?.classificationStatus ||
        (activeWindow?.classificationFailed ? 'invalid_response' : 'insufficient_context'),
      nudgeTitle: latestEvent?.nudgeTitle,
      nudgeBody: latestEvent?.nudgeBody,
      eventIds: latestEvent?.eventId ? [latestEvent.eventId] : [],
      runtimeMode: focusRuntime?.mode || 'normal',
      trackingState:
        isSystemSuspended || isLocallyPaused ? 'paused' : focusRuntime?.trackingState || 'normal',
      suspensionReasons: isSystemSuspended
        ? [
            ...(systemSuspension?.locked ||
            (runtimeSystemSuspensionIsAuthoritative &&
              runtimeSuspensionReasons.includes('screen_locked'))
              ? ['screen_locked']
              : []),
            ...(systemSuspension?.sleeping ||
            (runtimeSystemSuspensionIsAuthoritative &&
              runtimeSuspensionReasons.includes('system_sleep'))
              ? ['system_sleep']
              : []),
            ...(awaitingFreshActivity ? ['awaiting_system_resume'] : [])
          ]
        : isLocallyPaused
          ? ['manual_pause']
          : focusRuntime?.suspension.reasons || [],
      suspendedAtMs:
        systemSuspension?.suspendedAtMs ??
        localPause?.startedAtMs ??
        focusRuntime?.suspension?.manualPausedAtMs ??
        (isSystemSuspended ? timerSampledAtMs : null) ??
        null,
      pausedUntilMs: isLocallyPaused
        ? (localPause?.untilMs ?? null)
        : (focusRuntime?.suspension?.pausedUntilMs ?? null),
      phaseRemainingMs: focusRuntime?.phaseRemainingMs ?? null,
      phaseRemainingSampledAtMs:
        focusRuntime?.phaseRemainingMs === null || focusRuntime?.phaseRemainingMs === undefined
          ? null
          : timerSampledAtMs,
      phaseDurationMs: focusRuntime?.currentPhase?.plannedDurationMs ?? null,
      phaseGoal: focusRuntime?.currentPhase?.goal || null,
      phaseKind: focusRuntime?.currentPhase?.kind || null,
      phaseIndex: focusRuntime?.run?.currentPhaseIndex ?? null,
      taskCheckpointReached: Boolean(focusRuntime?.taskProgress?.checkpointAtMs),
      sessionTransitionAlertsEnabled: electronSettings?.sessionTransitionAlerts !== false,
      playSessionTransitionChime: electronSettings?.playSessionTransitionChime !== false,
      showDistractionNotchAlerts: electronSettings?.showDistractionNotchAlerts !== false,
      transitionNotice: focusRuntime?.transitionNotice ?? null
    })
  }, [
    latestEvent,
    activeWindow,
    categoryDetails,
    userCategories,
    todayEvents,
    token,
    displayWindowInfo,
    focusRuntime,
    isSystemSuspended,
    isLocallyPaused,
    systemSuspension,
    awaitingFreshActivity,
    runtimeSystemSuspensionIsAuthoritative,
    localPause,
    electronSettings?.notchTimerMode,
    electronSettings?.animateNotchTimerDigits
  ])

  const statusText = useMemo(
    () =>
      getStatusText(
        latestEvent,
        activeWindow,
        categoryId,
        isLoadingCategory,
        isLoadingUserCategories,
        categoryDetails
      ),
    [
      latestEvent,
      activeWindow,
      categoryId,
      isLoadingCategory,
      isLoadingUserCategories,
      categoryDetails
    ]
  )

  useRelevanceCheck(latestEvent, trackingActive, activeWindow, focusRuntime?.currentPhase?.goal)

  useDistractionNotification(
    categoryDetails as Category | null | undefined,
    latestEvent,
    trackingActive,
    focusRuntime?.currentPhase?.goal
  )

  useFocusTransitionAlerts(
    focusRuntime?.transitionNotice,
    electronSettings?.sessionTransitionAlerts,
    electronSettings?.playSessionTransitionChime
  )

  const cardBgColor = useMemo(() => getCardBgColor(categoryDetails), [categoryDetails])
  const statusTextColor = useMemo(() => getStatusTextColor(categoryDetails), [categoryDetails])

  const isLoadingPrimary =
    !activeWindow &&
    (isLoadingLatestEvent ||
      (token && !latestEvent && !isLoadingCategory && !isLoadingUserCategories))

  const handleOpenRecategorize = useRecategorizationHandler(
    latestEvent,
    displayWindowInfo,
    categoryDetails,
    onOpenRecategorizeDialog,
    activeWindow
  )
  const canRetryClassification =
    activeWindow?.classificationFailed ||
    latestEvent?.classificationStatus === 'invalid_response' ||
    latestEvent?.classificationStatus === 'ollama_unavailable'

  // An awaiting Pomodoro goal is an intentional capture gate. Present its
  // actual recovery choice before any stale post-wake marker; choosing a goal
  // or ending the run will reopen native capture and create the fresh boundary.
  if (isWaitingForPomodoroGoal) {
    return (
      <section
        className="tempo-inspector-section"
        aria-label="Pomodoro waiting for its next goal"
        aria-live="polite"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[.12em] text-muted-foreground">
              Pomodoro paused
            </p>
            <p className="mt-0.5 text-sm text-foreground">
              Choose the next goal, or end the session to resume normal tracking.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={onOpenFocusControls}
            title="Choose the goal for the next Pomodoro block"
          >
            <Play size={12} aria-hidden="true" />
            Set next goal
          </Button>
        </div>
      </section>
    )
  }

  if (runtimeSuspensionReasons.includes('calendar_event')) {
    return <section className="tempo-inspector-section" aria-label="Tracking paused for a calendar event" aria-live="polite">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-medium uppercase tracking-[.12em] text-muted-foreground">Calendar pause</p><p className="mt-0.5 text-sm text-foreground">Tracking resumes at {new Date(focusRuntime?.suspension?.pausedUntilMs || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}. Your focus timer is paused too.</p></div><Button variant="outline" size="xs" onClick={() => void window.api.resumeCalendarTracking()}>Resume now</Button></div>
    </section>
  }

  if (runtimeHasManualPause) {
    return (
      <section
        className="tempo-inspector-section"
        aria-label="Tracking manually paused"
        aria-live="polite"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[.12em] text-muted-foreground">
              Tracking paused
            </p>
            <p className="mt-0.5 text-sm text-foreground">
              Tempo is paused manually. Resume whenever you are ready.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={onResumeTracking}
            disabled={isResumingTracking}
            title="Resume monitoring and recheck the frontmost app"
          >
            <Play size={12} aria-hidden="true" />
            {isResumingTracking ? 'Resuming…' : 'Resume tracking'}
          </Button>
        </div>
      </section>
    )
  }

  if (needsSystemResumeAction) {
    const isSleeping =
      systemSuspension?.sleeping || runtimeSuspensionReasons.includes('system_sleep')
    const suspensionName = isSleeping ? 'after sleep' : 'while locked'
    return (
      <section
        className="tempo-inspector-section"
        aria-label="Tracking suspended"
        aria-live="polite"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[.12em] text-muted-foreground">
              Tracking paused
            </p>
            <p className="mt-0.5 text-sm text-foreground">
              {awaitingFreshActivity && !hasStaleSystemSuspension
                ? 'Tempo is waiting to recheck the frontmost app.'
                : `Tempo is still paused ${suspensionName}.`}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={onResumeTracking}
            disabled={isResumingTracking}
            title="Clear Tempo's stale sleep or lock state and recheck the frontmost app"
          >
            <Play size={12} aria-hidden="true" />
            {isResumingTracking ? 'Resuming…' : 'Resume tracking'}
          </Button>
        </div>
      </section>
    )
  }

  if (isLoadingPrimary) {
    return <DistractionStatusLoadingSkeleton cardBgColor={cardBgColor} />
  }

  return (
    <section className={clsx('tempo-inspector-section', cardBgColor)} aria-label="Current activity">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[.12em] text-muted-foreground">
          Now
        </p>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={onOpenMiniTimerClick}
          title="Show Tempo notch display"
        >
          <ExternalLink size={13} />
          Notch
        </button>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex-grow min-w-0 flex items-center">
          <AnimatePresence>
            <motion.div
              key={displayWindowInfo.ownerName}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className="flex-grow min-w-0 flex items-center"
            >
              {/* Icon Display Logic */}
              <ActivityIcon
                url={displayWindowInfo.isApp ? undefined : displayWindowInfo.url}
                appName={displayWindowInfo.ownerName}
                size={16}
                className="mr-2"
              />
              <span className="text-sm font-medium text-foreground truncate">
                {displayWindowInfo.title || displayWindowInfo.ownerName}
              </span>
            </motion.div>
          </AnimatePresence>
        </div>
        <div>
          <button
            type="button"
            className={`text-xs font-semibold ${statusTextColor} whitespace-nowrap flex items-center gap-1 hover:opacity-80`}
            onClick={handleOpenRecategorize}
            title="Re-categorize this activity"
          >
            {statusText}
            {latestEvent && categoryId && !isLoadingCategory && (
              <EditIcon size={14} className="ml-1 flex-shrink-0" />
            )}
          </button>
          {((latestEvent?.eventId && !categoryId) ||
            (activeWindow?.monitoringCaptureId && activeWindow.type !== 'system')) && (
            <Button
              variant="outline"
              size="sm"
              className="mt-1 h-7 px-2 text-xs"
              onClick={handleOpenRecategorize}
              aria-label="Choose whether this activity is productive or distracting"
            >
              Choose category
            </Button>
          )}
          {canRetryClassification && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1 text-xs"
              onClick={() => void window.api?.refreshCurrentActivity()}
              title="Capture and classify the current activity again"
            >
              Retry classification
            </Button>
          )}
          {(isLoadingCategory || isLoadingUserCategories || isLoadingTodayEvents) && categoryId && (
            <div className="text-xs text-muted-foreground mt-0.5">Updating...</div>
          )}
        </div>
      </div>
    </section>
  )
}

export default React.memo(DistractionStatusBar, arePropsEqual)
