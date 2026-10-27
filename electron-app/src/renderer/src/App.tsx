import { recategorizeRequest } from './lib/recategorizeRequest'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Category } from 'shared'
import { DashboardView } from './components/DashboardView'
import { OnboardingModal } from './components/OnboardingModal'
import RecategorizeDialog from './components/RecategorizeDialog'
import DistractionStatusBar from './components/ui/DistractionStatusBar'
import { Toaster } from './components/ui/toaster'
import { useAuth } from './contexts/AuthContext'
import { toast } from './hooks/use-toast'
import { uploadActiveWindowEvent } from './lib/activityUploader'
import {
  failedForegroundCapture,
  FirefoxSiteIdentityCache,
  type ForegroundActivityWindow
} from './lib/activityCaptureState'
import { SettingsPage } from './pages/SettingsPage'
import { AnalysisPage } from './pages/AnalysisPage'
import { type FirefoxCompanionState } from './components/FirefoxCompanionStatus'
import { TempoSidebar, type TempoPage } from './components/TempoSidebar'
import { TempoToolbar } from './components/TempoToolbar'
import { PaneResizeHandle } from './components/layout/PaneResizeHandle'
import { useWindowWidth } from './hooks/useWindowWidth'
import { trpc } from './utils/trpc'
import { useReminderUpdates } from './hooks/useReminders'

export const APP_NAME = 'Tempo' + (process.env.NODE_ENV === 'development' ? ' Dev' : '')
export const APP_USP = 'The first context and goal-aware distraction and productivity tracker.'

const SIDEBAR_MIN_WIDTH = 180
const SIDEBAR_DEFAULT_WIDTH = 218

const persistedPaneWidth = (key: string, fallback: number): number => {
  const value = Number(localStorage.getItem(key))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export interface ActivityToRecategorize {
  nameToDisplay: string
  eventIds: string[]
  currentCategoryId: string
  currentCategoryName: string
  foregroundCapture?: ForegroundActivityWindow
}

export function MainAppContent() {
  useReminderUpdates()
  const { isAuthenticated, token, user } = useAuth()
  const viewportWidth = useWindowWidth()
  const [activeWindow, setActiveWindow] = useState<ForegroundActivityWindow | null>(null)
  const currentCaptureSequenceRef = useRef(0)
  const firefoxSiteIdentitiesRef = useRef(new FirefoxSiteIdentityCache())
  const classificationUiDeadlineRef = useRef<number | null>(null)
  const enrichmentRefreshTimeoutRef = useRef<number | null>(null)
  const firefoxPageContextRef = useRef(
    new Map<string, { siteHost: string; pageContent: string | null; expiresAtMs: number }>()
  )
  const [isMiniTimerVisible, setIsMiniTimerVisible] = useState(false)
  const [notchHelperAvailability, setNotchHelperAvailability] = useState<
    'starting' | 'ready' | 'unavailable'
  >('starting')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [activePage, setActivePage] = useState<TempoPage>(
    () => (localStorage.getItem('tempoDesktopPage') as TempoPage) || 'dashboard'
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('tempoSidebarCollapsed') === 'true'
  )
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    persistedPaneWidth('tempoSidebarWidth', SIDEBAR_DEFAULT_WIDTH)
  )
  const [focusOpenRequest, setFocusOpenRequest] = useState(0)
  const [focusQuickActionRequest, setFocusQuickActionRequest] = useState(0)
  const [todayPlanOpenRequest, setTodayPlanOpenRequest] = useState(0)
  const [planningOpenRequest, setPlanningOpenRequest] = useState(0)
  const [isSystemResumePending, setIsSystemResumePending] = useState(false)
  const [systemSuspension, setSystemSuspension] = useState({
    locked: false,
    sleeping: false,
    suspendedAtMs: null as number | null,
    awaitingFreshActivity: false
  })
  const [notchPause, setNotchPause] = useState<{ startedAtMs: number; untilMs: number } | null>(
    null
  )
  const [firefoxCompanionState, setFirefoxCompanionState] =
    useState<FirefoxCompanionState>('not_detected')

  // Keep a useful detail area even at the window's minimum width. A sidebar
  // should feel freely resizable, but must not be able to starve its content.
  const sidebarMaxWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(360, viewportWidth - 540))

  const trpcUtils = trpc.useContext()

  const [isRecategorizeDialogOpen, setIsRecategorizeDialogOpen] = useState(false)
  const [recategorizeTarget, setRecategorizeTarget] = useState<ActivityToRecategorize | null>(null)

  const { data: allCategoriesData, isLoading: isLoadingAllCategories } =
    trpc.category.getCategories.useQuery({ token: token || '' }, { enabled: !!token })
  const allCategories: Category[] | undefined = allCategoriesData as Category[] | undefined
  const { data: focusRuntime } = trpc.focusRuntime.getState.useQuery(
    { token: token || '' },
    {
      enabled: !!token,
      // The server scheduler is authoritative and the one-shot deadline below
      // refreshes presentation exactly at a phase boundary. Commands, wake,
      // reconnect, and captures invalidate this cache directly, so an active
      // focus run no longer requires a permanent ten-second heartbeat.
      refetchOnWindowFocus: true
    }
  )
  const focusRuntimeUtils = trpc.useContext()
  const pauseFocusMutation = trpc.focusRuntime.pause.useMutation()
  const resumeFocusMutation = trpc.focusRuntime.resume.useMutation()
  const skipBreakMutation = trpc.focusRuntime.skipBreak.useMutation()
  const endFocusMutation = trpc.focusRuntime.endRun.useMutation()
  const finishTaskMutation = trpc.focusRuntime.finishTaskSession.useMutation()
  const addSessionTimeMutation = trpc.focusRuntime.addSessionTime.useMutation()
  const resumeSystemSuspensionMutation = trpc.focusRuntime.resumeSystemSuspension.useMutation()

  // The server-owned scheduler is authoritative. This one-shot refresh only
  // shortens presentation latency if a renderer happens to miss its normal
  // recovery poll; it does not advance, classify, or account for any time.
  useEffect(() => {
    const deadline = focusRuntime?.nextDeadlineAtMs
    if (!deadline) return
    const timeout = window.setTimeout(
      () => void focusRuntimeUtils.focusRuntime.getState.invalidate(),
      Math.max(50, deadline - Date.now() + 80)
    )
    return () => window.clearTimeout(timeout)
  }, [focusRuntime?.nextDeadlineAtMs, focusRuntimeUtils])

  // Recover from the rare case where a macOS wake/unlock notification never
  // arrives. Both the persisted focus runtime and native observer are reset,
  // but no timer starts until the normal fresh 750 ms activity capture lands.
  const handleResumeTrackingAfterSystemSleep = useCallback(async () => {
    if (!token || isSystemResumePending) return
    setIsSystemResumePending(true)
    try {
      const hasManualPause = (focusRuntime?.suspension?.reasons || []).includes('manual_pause')
      if (hasManualPause) {
        // A manual pause is independent of the stale sleep/lock gate. Clear
        // it on the authoritative runtime first, then atomically release the
        // native capture gate and schedule the normal stable foreground read.
        const runtime = await resumeFocusMutation.mutateAsync({ token })
        focusRuntimeUtils.focusRuntime.getState.setData({ token }, runtime)
        const recovery = await window.api?.resumeManualTracking()
        if (!recovery?.cleared) throw new Error('Tempo could not resume manual tracking.')
        setNotchPause(null)
        setActiveWindow(null)
        setSystemSuspension({
          locked: false,
          sleeping: false,
          suspendedAtMs: null,
          awaitingFreshActivity: recovery.captureScheduled
        })
        void focusRuntimeUtils.focusRuntime.getState.invalidate()
        toast({
          title: 'Tracking resumed',
          description: recovery.captureScheduled
            ? 'Tempo is rechecking the frontmost app.'
            : 'Tempo will resume when the current focus break or goal state is resolved.'
        })
        return
      }

      const recovery = await window.api?.resumeAfterSystemSuspension()
      if (!recovery?.cleared) throw new Error('Tempo could not clear the system suspension.')

      setActiveWindow(null)
      setSystemSuspension({
        locked: false,
        sleeping: false,
        suspendedAtMs: null,
        awaitingFreshActivity: recovery.captureScheduled
      })
      // The main process immediately tells the helper that the system-owned
      // freeze is clear. Persist the matching runtime state afterwards; the
      // notch can now show “Resuming” during the deliberate 750 ms capture
      // boundary instead of appearing stuck asleep.
      const runtime = await resumeSystemSuspensionMutation.mutateAsync({ token })
      focusRuntimeUtils.focusRuntime.getState.setData({ token }, runtime)
      void focusRuntimeUtils.focusRuntime.getState.invalidate()
      toast({
        title: recovery.captureScheduled ? 'Tracking resumed' : 'System suspension cleared',
        description: recovery.captureScheduled
          ? 'Tempo is rechecking the frontmost app.'
          : 'Your existing manual pause or break still applies.'
      })
    } catch {
      toast({
        title: 'Could not resume tracking',
        description: 'Try again after confirming that your Mac is unlocked.',
        variant: 'destructive'
      })
    } finally {
      setIsSystemResumePending(false)
    }
  }, [
    token,
    isSystemResumePending,
    focusRuntime,
    resumeFocusMutation,
    resumeSystemSuspensionMutation,
    focusRuntimeUtils
  ])

  // A server `paused` state can also mean lock/sleep or the short
  // post-unlock “awaiting fresh activity” boundary. Those states must *not*
  // be reflected back as a manual native pause, or they deadlock the fresh
  // capture that clears them.
  const runtimeSuspensionReasons: string[] = focusRuntime?.suspension?.reasons || []
  const runtimeCapturePaused =
    runtimeSuspensionReasons.some((reason) =>
      ['manual_pause', 'pomodoro_break', 'long_break', 'awaiting_goal'].includes(reason)
    ) || Boolean(notchPause && notchPause.untilMs > Date.now())

  useEffect(() => {
    if (!notchPause) return
    const remainingMs = Math.max(0, notchPause.untilMs - Date.now())
    const timeout = window.setTimeout(() => {
      setNotchPause(null)
      focusRuntimeUtils.focusRuntime.getState.invalidate()
    }, remainingMs + 50)
    return () => window.clearTimeout(timeout)
  }, [notchPause, focusRuntimeUtils])

  useEffect(() => {
    // Native lock/sleep state is independent from this user/session capture
    // gate. Never clear a native system suspension from the renderer.
    window.api?.setActivityCapturePaused(runtimeCapturePaused)
  }, [runtimeCapturePaused])

  useEffect(() => {
    if (!window.api?.onFloatingFocusCommand) return () => {}
    return window.api.onFloatingFocusCommand((command) => {
      if (!token) return
      const syncRuntime = (runtime: any) => {
        focusRuntimeUtils.focusRuntime.getState.setData({ token }, runtime)
        void focusRuntimeUtils.focusRuntime.getState.invalidate()
      }
      if (command.action === 'pause' && command.durationMinutes) {
        const startedAtMs = Date.now()
        setNotchPause({ startedAtMs, untilMs: startedAtMs + command.durationMinutes * 60_000 })
        pauseFocusMutation.mutate(
          { token, durationMinutes: command.durationMinutes as 1 | 5 | 20 | 30 | 60 | 120 },
          {
            onSuccess: syncRuntime,
            onError: () => {
              setNotchPause(null)
              toast({
                title: 'Could not pause Tempo',
                description: 'Monitoring remains active.',
                variant: 'destructive'
              })
            }
          }
        )
      } else if (command.action === 'resume') {
        setNotchPause(null)
        resumeFocusMutation.mutate({ token }, { onSuccess: syncRuntime })
      } else if (command.action === 'skipBreak') {
        skipBreakMutation.mutate({ token }, { onSuccess: syncRuntime })
      } else if (command.action === 'endRun') {
        endFocusMutation.mutate({ token }, { onSuccess: syncRuntime })
      } else if (
        command.action === 'extendSession' &&
        command.noticeId &&
        command.durationMinutes
      ) {
        addSessionTimeMutation.mutate(
          { token, noticeId: command.noticeId, minutes: command.durationMinutes },
          {
            onSuccess: (state) => {
              syncRuntime(state)
              void focusRuntimeUtils.focusRuntime.getTimelineRuns.invalidate()
              void focusRuntimeUtils.goals.getActiveContext.invalidate()
              void window.api?.refreshCurrentActivity()
            },
            onError: (error) =>
              toast({
                title: 'Could not add time',
                description: error.message,
                variant: 'destructive'
              })
          }
        )
      } else if (command.action === 'finishTask') {
        const runId = focusRuntime?.run?.id
        if (!runId || !focusRuntime?.taskProgress?.checkpointAtMs) return
        finishTaskMutation.mutate(
          { token, runId },
          {
            onSuccess: (state) => {
              syncRuntime(state)
              void focusRuntimeUtils.goals.getDailyPlan.invalidate()
              void focusRuntimeUtils.goals.getActiveContext.invalidate()
              void window.api?.refreshCurrentActivity()
            }
          }
        )
      }
    })
  }, [
    token,
    focusRuntimeUtils,
    pauseFocusMutation,
    resumeFocusMutation,
    skipBreakMutation,
    endFocusMutation,
    finishTaskMutation,
    addSessionTimeMutation,
    focusRuntime
  ])

  const updateActivityCategoryMutation = trpc.activeWindowEvents.recategorizeBlock.useMutation({
    onSuccess: (result) => {
      const rememberedDescription =
        result.remembered.scope === 'page_goal'
          ? `Tempo will remember ${result.remembered.label || 'this page'} for this goal.`
          : result.remembered.scope === 'exact'
            ? 'Tempo will remember this exact activity for this goal.'
            : 'The selected activity was updated.'
      const learningDescription =
        result.learning.status === 'created'
          ? result.learning.scope === 'list'
            ? ' A preference now applies to similar work in this list.'
            : ' Learning was saved for the original task.'
          : result.learning.reasons.includes('missing_tool_identity') &&
              result.remembered.scope !== 'none'
            ? ' The page correction is saved. Broader learning needs a verified website identity.'
            : ` Learning was not saved: ${result.learning.reasons.join(', ').replace(/_/g, ' ')}.`
      toast({
        title: 'Activity Re-categorized',
        description: `${rememberedDescription}${learningDescription}`
      })
      void trpcUtils.activeWindowEvents.getLatestEvent.invalidate()
      void trpcUtils.activeWindowEvents.getScopedPreferences.invalidate()
      void window.api?.refreshCurrentActivity()
      trpcUtils.activeWindowEvents.getEventsForDateRange.invalidate()
      trpcUtils.analytics.getPeriod.invalidate()
      setIsRecategorizeDialogOpen(false)
      setRecategorizeTarget(null)
    },
    onError: (error) => {
      console.error('Activity correction failed.')
      toast({
        title: 'Error',
        description: 'Failed to re-categorize activity. ' + error.message,
        variant: 'destructive'
      })
    }
  })

  const openRecategorizeDialog = useCallback(
    (target: ActivityToRecategorize) => {
      setRecategorizeTarget(target)
      setIsRecategorizeDialogOpen(true)
    },
    [setRecategorizeTarget, setIsRecategorizeDialogOpen]
  )

  useEffect(
    () =>
      window.api.onClassificationRelevanceCheck(async (eventId) => {
        if (!token) return
        try {
          const event = await trpcUtils.activeWindowEvents.getClassificationEvent.fetch({
            token,
            eventId
          })
          openRecategorizeDialog({
            eventIds: [eventId],
            nameToDisplay: event.title || event.ownerName,
            currentCategoryId: event.categoryId || 'uncategorized',
            currentCategoryName:
              allCategories?.find((c) => c._id === event.categoryId)?.name ||
              (event.categoryId ? 'Classified activity' : 'Needs more context')
          })
        } catch {
          toast({
            title: 'Activity unavailable',
            description: 'This activity could not be opened.',
            variant: 'destructive'
          })
        }
      }),
    [token, openRecategorizeDialog, trpcUtils, toast, allCategories]
  )

  const prepareCurrentCorrection =
    trpc.activeWindowEvents.prepareCurrentActivityCorrection.useMutation()
  const handleSaveRecategorize = useCallback(
    async (
      newCategoryId: string,
      options?: { learningGoalRef?: string; learnFromCorrection?: boolean }
    ) => {
      if (!recategorizeTarget || !token) {
        toast({
          title: 'Error',
          description: 'Missing data for re-categorization.',
          variant: 'destructive'
        })
        return
      }

      let eventIds = recategorizeTarget.eventIds
      const foreground = recategorizeTarget.foregroundCapture
      if (!eventIds.length && foreground?.monitoringCaptureId && foreground.type !== 'system') {
        try {
          const event = await prepareCurrentCorrection.mutateAsync({
            token,
            monitoringCaptureId: foreground.monitoringCaptureId,
            ownerName: foreground.ownerName,
            title: foreground.title,
            type: foreground.type,
            browser: foreground.browser,
            windowId: foreground.windowId,
            pageCorrectionKey: foreground.pageCorrectionKey,
            siteIdentity: foreground.siteIdentity
          })
          eventIds = [event.eventId!]
          window.api.acknowledgeActivityCapture(foreground.monitoringCaptureId)
        } catch {
          toast({
            title: 'Could not save your classification',
            description: 'Please try again.',
            variant: 'destructive'
          })
          return
        }
      }
      updateActivityCategoryMutation.mutate({
        token,
        eventIds,
        newCategoryId,
        correctionActionId: crypto.randomUUID(),
        rememberExactMatch: true,
        learningGoalRef: options?.learningGoalRef,
        learnFromCorrection: options?.learnFromCorrection !== false
      })
    },
    [recategorizeTarget, token, updateActivityCategoryMutation, prepareCurrentCorrection, toast]
  )

  useEffect(() => {
    if (!window.api?.onDisplayRecategorizePage) return
    return window.api.onDisplayRecategorizePage((request: unknown) => {
      const target = recategorizeRequest(request)
      if (target) openRecategorizeDialog(target)
    })
  }, [openRecategorizeDialog])

  // The notch renderer is intentionally token-free. It asks this authenticated
  // renderer to perform the same exact-block mutation used by the dashboard.
  useEffect(() => {
    if (!window.api?.onFloatingRecategorizeRequest) return () => {}
    return window.api.onFloatingRecategorizeRequest((request) => {
      if (!token || request.eventIds.length === 0 || !request.newCategoryId) {
        window.api.sendFloatingRecategorizeResult({
          requestId: request.requestId,
          ok: false,
          message: 'Tempo is not ready to recategorize this activity.'
        })
        return
      }
      updateActivityCategoryMutation.mutate(
        {
          token,
          eventIds: request.eventIds,
          newCategoryId: request.newCategoryId,
          correctionActionId: crypto.randomUUID(),
          rememberExactMatch: true
        },
        {
          onSuccess: () => {
            trpcUtils.activeWindowEvents.getEventsForDateRange.invalidate()
            trpcUtils.activeWindowEvents.getLatestEvent.invalidate()
            trpcUtils.analytics.getPeriod.invalidate()
            window.api.sendFloatingRecategorizeResult({ requestId: request.requestId, ok: true })
          },
          onError: (error) =>
            window.api.sendFloatingRecategorizeResult({
              requestId: request.requestId,
              ok: false,
              message: error.message
            })
        }
      )
    })
  }, [token, trpcUtils, updateActivityCategoryMutation])

  const eventCreationMutation = trpc.activeWindowEvents.create.useMutation({
    onError: (error) => {
      console.error('Activity delivery failed.')
    }
  })
  const reuseFirefoxNavigationMutation =
    trpc.activeWindowEvents.reuseFirefoxNavigation.useMutation()

  // Onboarding is a one-time setup; Settings can explicitly reopen it.
  useEffect(() => {
    if (isAuthenticated && user) {
      setShowOnboarding(user.hasCompletedOnboarding !== true)
    }
  }, [isAuthenticated, user])

  const handleOnboardingComplete = () => {
    setShowOnboarding(false)
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.invoke('set-open-at-login', true)
      // Enable permission requests now that onboarding is complete
      window.electron.ipcRenderer.invoke('enable-permission-requests')
    }
  }

  const handleResetOnboarding = () => {
    setShowOnboarding(true)
  }

  const handleOpenMiniTimer = () => {
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.send('show-floating-window')
    }
  }

  const handleRefreshMonitoring = async () => {
    try {
      const refreshed = await window.api?.restartActivityMonitoring()
      if (refreshed) {
        toast({
          title: 'Monitoring restarted',
          description: 'Tempo is safely rechecking the frontmost app.'
        })
      } else {
        toast({
          title: 'Monitoring is paused',
          description: 'Resume Tempo or unlock your Mac before refreshing.',
          variant: 'destructive'
        })
      }
    } catch {
      toast({
        title: 'Could not refresh monitoring',
        description: 'Try reopening Tempo if this persists.',
        variant: 'destructive'
      })
    }
  }

  useEffect(() => {
    if (!window.api?.onFirefoxNavigationState) return () => {}
    return window.api.onFirefoxNavigationState((state) => {
      firefoxSiteIdentitiesRef.current.remember(state.pageCorrectionKey, state.siteIdentity)
      setFirefoxCompanionState('connected')
      const contexts = firefoxPageContextRef.current
      const now = Date.now()
      for (const [fingerprint, context] of contexts) {
        if (context.expiresAtMs <= now) contexts.delete(fingerprint)
      }
      contexts.set(state.navigationFingerprint, {
        siteHost: state.siteHost,
        pageContent: state.pageContent,
        expiresAtMs: now + 30_000
      })
      window.setTimeout(() => {
        const current = contexts.get(state.navigationFingerprint)
        if (current && current.expiresAtMs <= Date.now())
          contexts.delete(state.navigationFingerprint)
      }, 30_100)
      while (contexts.size > 8) contexts.delete(contexts.keys().next().value as string)
    })
  }, [])

  useEffect(() => {
    const cleanup = window.api.onActivityCapture((capture) => {
      const { details: nativeDetails, captureId, sequence } = capture
      const capturedDetails = {
        ...nativeDetails,
        siteIdentity:
          nativeDetails.siteIdentity ||
          (nativeDetails.browser === 'firefox'
            ? firefoxSiteIdentitiesRef.current.get(nativeDetails.pageCorrectionKey)
            : undefined)
      }
      const transientFirefoxContext = capturedDetails.navigationFingerprint
        ? firefoxPageContextRef.current.get(capturedDetails.navigationFingerprint)
        : undefined
      const details = transientFirefoxContext
        ? {
            ...capturedDetails,
            siteHost: transientFirefoxContext.siteHost,
            content: capturedDetails.content || transientFirefoxContext.pageContent || undefined,
            contentSource: capturedDetails.content
              ? capturedDetails.contentSource
              : transientFirefoxContext.pageContent
                ? ('dom' as const)
                : capturedDetails.contentSource
          }
        : capturedDetails
      if (sequence < currentCaptureSequenceRef.current) return
      if (enrichmentRefreshTimeoutRef.current !== null)
        window.clearTimeout(enrichmentRefreshTimeoutRef.current)
      currentCaptureSequenceRef.current = sequence
      if (classificationUiDeadlineRef.current !== null)
        window.clearTimeout(classificationUiDeadlineRef.current)
      const finishCapture = (succeeded: boolean) => {
        if (sequence !== currentCaptureSequenceRef.current) return
        if (classificationUiDeadlineRef.current !== null)
          window.clearTimeout(classificationUiDeadlineRef.current)
        classificationUiDeadlineRef.current = null
        setActiveWindow((current) =>
          succeeded ? null : failedForegroundCapture(current, sequence)
        )
      }
      const systemName = details.ownerName || ''
      if (systemName === 'System Lock' || systemName === 'System Sleep') {
        setSystemSuspension((previous) => ({
          locked: previous.locked || systemName === 'System Lock',
          sleeping: previous.sleeping || systemName === 'System Sleep',
          suspendedAtMs: previous.suspendedAtMs ?? details.timestamp ?? Date.now(),
          awaitingFreshActivity: false
        }))
      } else if (systemName === 'System Unlock' || systemName === 'System Wake') {
        setSystemSuspension((previous) => {
          const locked = systemName === 'System Unlock' ? false : previous.locked
          const sleeping = systemName === 'System Wake' ? false : previous.sleeping
          return {
            locked,
            sleeping,
            suspendedAtMs: locked || sleeping ? previous.suspendedAtMs : null,
            awaitingFreshActivity: !locked && !sleeping
          }
        })
      }
      // Browser text belongs only to the in-flight classification request. The
      // UI uses the persisted, derived result and must not retain OCR text.
      setActiveWindow({
        ...details,
        content: null,
        siteHost: null,
        monitoringCaptureId: captureId,
        monitoringSequence: sequence
      })
      // The server owns the ten-second inference deadline. This renderer-side
      // guard prevents a lost response or disconnected request from leaving a
      // misleading permanent “Comparing…” state.
      classificationUiDeadlineRef.current = window.setTimeout(() => {
        if (sequence !== currentCaptureSequenceRef.current) return
        finishCapture(false)
        if (token) void trpcUtils.activeWindowEvents.getLatestEvent.invalidate()
      }, 12_000)
      if (
        details.browser === 'firefox' &&
        details.contentCaptureStatus === 'navigation_pending' &&
        details.navigationFingerprint &&
        details.windowId &&
        token
      ) {
        const captureReason =
          details.captureReason === 'firefox_activation'
            ? 'firefox_activation'
            : 'firefox_tab_switch'
        const classifyDomOrCapture = () => {
          if (sequence !== currentCaptureSequenceRef.current) return
          if (details.content?.trim()) {
            firefoxPageContextRef.current.delete(details.navigationFingerprint!)
            setActiveWindow({
              ...details,
              content: null,
              siteHost: null,
              contentCaptureStatus: 'captured',
              monitoringCaptureId: captureId,
              monitoringSequence: sequence
            })
            void uploadActiveWindowEvent(
              token,
              {
                ...details,
                contentSource: 'dom',
                contentCaptureStatus: 'captured',
                monitoringCaptureId: captureId,
                monitoringSequence: sequence
              },
              eventCreationMutation.mutateAsync
            )
              .then((createdEvent) => {
                if (createdEvent) window.api.acknowledgeActivityCapture(captureId)
                if (sequence !== currentCaptureSequenceRef.current) return
                if (!createdEvent) return finishCapture(false)
                void trpcUtils.activeWindowEvents.getLatestEvent.cancel()
                trpcUtils.activeWindowEvents.getLatestEvent.setData({ token }, createdEvent)
                trpcUtils.activeWindowEvents.getEventsForDateRange.invalidate()
                trpcUtils.analytics.getPeriod.invalidate()
                finishCapture(true)
              })
              .catch(() => finishCapture(false))
          } else {
            window.api.captureFirefoxNavigation({
              windowId: details.windowId!,
              title: details.title,
              navigationFingerprint: details.navigationFingerprint!
            })
          }
        }
        void reuseFirefoxNavigationMutation
          .mutateAsync({
            token,
            windowId: details.windowId,
            title: details.title,
            navigationFingerprint: details.navigationFingerprint,
            pageCorrectionKey: details.pageCorrectionKey,
            captureReason,
            timestamp: details.timestamp || Date.now(),
            monitoringCaptureId: captureId,
            siteIdentity: details.siteIdentity
          })
          .then((result) => {
            if (result.reused) window.api.acknowledgeActivityCapture(captureId)
            if (sequence !== currentCaptureSequenceRef.current) return
            if (result.reused) {
              firefoxPageContextRef.current.delete(details.navigationFingerprint!)
              setFirefoxCompanionState('cache_hit')
              void trpcUtils.activeWindowEvents.getLatestEvent.cancel()
              trpcUtils.activeWindowEvents.getLatestEvent.setData({ token }, result.event)
              trpcUtils.activeWindowEvents.getEventsForDateRange.invalidate()
              trpcUtils.analytics.getPeriod.invalidate()
              finishCapture(true)
            } else {
              setFirefoxCompanionState('cache_miss')
              classifyDomOrCapture()
            }
          })
          .catch(() => {
            // A local lookup failure must not leave Firefox permanently pending.
            classifyDomOrCapture()
          })
        return
      }
      if (details && isAuthenticated && token) {
        void uploadActiveWindowEvent(
          token,
          { ...details, monitoringCaptureId: captureId, monitoringSequence: sequence },
          eventCreationMutation.mutateAsync
        )
          .then((createdEvent) => {
            if (createdEvent) window.api.acknowledgeActivityCapture(captureId)
            if (sequence !== currentCaptureSequenceRef.current) return
            if (!createdEvent) return finishCapture(false)
            void trpcUtils.activeWindowEvents.getLatestEvent.cancel()
            trpcUtils.activeWindowEvents.getLatestEvent.setData({ token }, createdEvent)
            trpcUtils.activeWindowEvents.getEventsForDateRange.invalidate()
            trpcUtils.analytics.getPeriod.invalidate()
            finishCapture(true)
            // System transitions and the first capture after one both change the
            // persisted runtime. Reconcile once per committed capture so the
            // dashboard and notch do not wait for a background heartbeat.
            void trpcUtils.focusRuntime.getState.invalidate()
            // Enrichment is intentionally server-side and starts after twelve
            // stable seconds. Refresh once after that window without restoring
            // the old one-second database polling loop.
            enrichmentRefreshTimeoutRef.current = window.setTimeout(() => {
              if (sequence !== currentCaptureSequenceRef.current) return
              trpcUtils.activeWindowEvents.getLatestEvent.invalidate()
              trpcUtils.activeWindowEvents.getEventsForDateRange.invalidate()
              trpcUtils.analytics.getPeriod.invalidate()
            }, 18_000)
            if (details.type !== 'system') {
              setSystemSuspension((previous) =>
                previous.awaitingFreshActivity
                  ? { ...previous, awaitingFreshActivity: false }
                  : previous
              )
            }
          })
          .catch(() => finishCapture(false))
          .finally(() => {
            // Browser evidence remains request-only, including failed uploads.
            if (details.navigationFingerprint)
              firefoxPageContextRef.current.delete(details.navigationFingerprint)
          })
      }
    })
    return cleanup
  }, [
    isAuthenticated,
    token,
    eventCreationMutation.mutateAsync,
    reuseFirefoxNavigationMutation,
    trpcUtils
  ])

  useEffect(() => {
    if (isAuthenticated && token) window.api.markActivityPipelineReady()
  }, [isAuthenticated, token])

  useEffect(() => {
    // Fetch initial state
    const fetchInitialVisibility = async () => {
      if (window.api?.getFloatingWindowVisibility) {
        try {
          const isVisible = await window.api.getFloatingWindowVisibility()
          setIsMiniTimerVisible(isVisible)
        } catch (error) {
          console.error('Failed to get mini timer visibility', error)
        }
      }
    }

    fetchInitialVisibility()

    // Listener for subsequent changes
    const handleVisibilityChange = (_event: unknown, isVisible: boolean) => {
      setIsMiniTimerVisible(isVisible)
    }

    const ipcRenderer = window.electron?.ipcRenderer
    ipcRenderer?.on('floating-window-visibility-changed', handleVisibilityChange)
    return () => {
      ipcRenderer?.removeListener('floating-window-visibility-changed', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    let disposed = false
    window.api
      ?.getNotchHelperAvailability()
      .then((state) => {
        if (!disposed) setNotchHelperAvailability(state)
      })
      .catch(() => {
        if (!disposed) setNotchHelperAvailability('unavailable')
      })
    const cleanup = window.api?.onNotchHelperAvailability?.(setNotchHelperAvailability)
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  // auto open mini timer when onboarding is completed and the user is authenticated
  useEffect(() => {
    if (isAuthenticated && !showOnboarding && window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.send('show-floating-window')
    }
  }, [isAuthenticated, showOnboarding])

  useEffect(() => {
    localStorage.setItem('tempoDesktopPage', activePage)
  }, [activePage])

  useEffect(() => {
    localStorage.setItem('tempoSidebarCollapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    setSidebarWidth((width) => Math.min(sidebarMaxWidth, Math.max(SIDEBAR_MIN_WIDTH, width)))
  }, [sidebarMaxWidth])

  useEffect(() => {
    localStorage.setItem('tempoSidebarWidth', String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    if (!window.api?.onTempoDesktopCommand) return () => {}
    return window.api.onTempoDesktopCommand((command) => {
      if (command === 'dashboard' || command === 'analysis' || command === 'settings')
        setActivePage(command)
      if (command === 'toggle-sidebar') setSidebarCollapsed((collapsed) => !collapsed)
      if (command === 'start-focus') setFocusOpenRequest((request) => request + 1)
      if (command === 'pause-or-resume') setFocusQuickActionRequest((request) => request + 1)
      if (command === 'set-today-plan') {
        setActivePage('dashboard')
        setTodayPlanOpenRequest((request) => request + 1)
      }
      if (command === 'set-weekly-focus') {
        setActivePage('settings')
        setPlanningOpenRequest((request) => request + 1)
      }
    })
  }, [])

  return (
    <div className="h-full flex min-h-0 overflow-hidden">
      {!sidebarCollapsed && (
        <>
          <div
            className="tempo-sidebar-pane"
            style={{ width: sidebarWidth, flexBasis: sidebarWidth }}
          >
            <TempoSidebar
              activePage={activePage}
              onNavigate={setActivePage}
              collapsed={sidebarCollapsed}
              firefoxState={firefoxCompanionState}
            />
          </div>
          <PaneResizeHandle
            ariaLabel="Resize sidebar and content"
            value={sidebarWidth}
            min={SIDEBAR_MIN_WIDTH}
            max={sidebarMaxWidth}
            defaultValue={SIDEBAR_DEFAULT_WIDTH}
            onValueChange={setSidebarWidth}
          />
        </>
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TempoToolbar
          page={activePage}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
          onShowSettings={() => setActivePage('settings')}
          runtime={focusRuntime}
          focusOpenRequest={focusOpenRequest}
          focusQuickActionRequest={focusQuickActionRequest}
        />
        {notchHelperAvailability === 'unavailable' && (
          <div className="mx-4 mt-3 flex items-center justify-between rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs">
            <span>Notch display unavailable.</span>
            <button
              type="button"
              className="font-medium text-amber-700 hover:underline dark:text-amber-300"
              onClick={() => {
                setNotchHelperAvailability('starting')
                window.api.retryNotchHelper()
              }}
            >
              Retry
            </button>
          </div>
        )}
        {activePage === 'dashboard' && (
          <DashboardView
            todayPlanOpenRequest={todayPlanOpenRequest}
            nowActivity={
              <DistractionStatusBar
                activeWindow={activeWindow}
                onOpenMiniTimerClick={handleOpenMiniTimer}
                isMiniTimerVisible={isMiniTimerVisible}
                onOpenRecategorizeDialog={openRecategorizeDialog}
                onSettingsClick={() => setActivePage('settings')}
                isSettingsOpen={false}
                focusRuntime={focusRuntime}
                systemSuspension={systemSuspension}
                localPause={notchPause}
                onResumeTracking={handleResumeTrackingAfterSystemSleep}
                onOpenFocusControls={() => setFocusOpenRequest((request) => request + 1)}
                isResumingTracking={isSystemResumePending}
              />
            }
          />
        )}
        {activePage === 'analysis' && <AnalysisPage />}
        {activePage === 'settings' && (
          <SettingsPage
            onResetOnboarding={handleResetOnboarding}
            onRestartMonitoring={() => void handleRefreshMonitoring()}
            planningOpenRequest={planningOpenRequest}
          />
        )}
      </div>

      {showOnboarding && <OnboardingModal onComplete={handleOnboardingComplete} />}
      <Toaster />
      {allCategories && recategorizeTarget && (
        <RecategorizeDialog
          open={isRecategorizeDialogOpen}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setRecategorizeTarget(null)
            }
            setIsRecategorizeDialogOpen(isOpen)
          }}
          activityTarget={recategorizeTarget}
          allCategories={allCategories}
          onSave={handleSaveRecategorize}
          isLoading={
            updateActivityCategoryMutation.isLoading ||
            prepareCurrentCorrection.isLoading ||
            isLoadingAllCategories
          }
        />
      )}
    </div>
  )
}
