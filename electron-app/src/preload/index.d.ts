import { ElectronAPI } from '@electron-toolkit/preload'
import { ActiveWindowDetails, Category } from 'shared/dist/types.js'

// Use the BaseElectronAPI type from electron-toolkit if available
type BaseElectronAPI = ElectronAPI

// Permission types and status enums (must match the preload)
export enum PermissionType {
  Accessibility = 0,
  AppleEvents = 1,
  ScreenRecording = 2
}

export enum PermissionStatus {
  Denied = 0,
  Granted = 1,
  Pending = 2
}

// Define ActiveWindowDetails here, as it's used by the api type
export interface ActiveWindowDetails {
  id: number
  ownerName: string
  type: 'window' | 'browser' | 'system'
  browser: 'chrome' | 'safari' | 'firefox'
  title: string
  url?: string
  content?: string
  contentSource?: 'dom' | 'ocr' | 'title' | null
  siteHost?: string | null
  contentCaptureStatus?:
    | 'captured'
    | 'permission_denied'
    | 'capture_failed'
    | 'no_text'
    | 'navigation_pending'
    | null
  navigationFingerprint?: string | null
  pageCorrectionKey?: string | null
  windowId?: number
  timestamp?: number
}

// Define a more specific type for ipcRenderer if BaseElectronAPI is not sufficient
interface CustomIpcRenderer extends BaseElectronAPI['ipcRenderer'] {
  removeListener: (channel: string, listener: (...args: any[]) => void) => void
  // Potentially include other methods like on, send, invoke if they also need explicit typing
  // For now, let's assume BaseElectronAPI['ipcRenderer'] has them, and we only add/ensure removeListener
  on: (channel: string, listener: (...args: any[]) => void) => void
  send: (channel: string, ...args: any[]) => void
  invoke: (channel: string, ...args: any[]) => Promise<any>
}

interface CustomElectronAPI extends BaseElectronAPI {
  ipcRenderer: CustomIpcRenderer
}

declare global {
  interface Window {
    electron: CustomElectronAPI // Use the custom, more specific type
    api: {
      getAppleCalendarStatus: (range?: {startMs: number; endMs: number}) => Promise<import('shared/calendar').CalendarStatus>
      connectAppleCalendar: () => Promise<import('shared/calendar').CalendarStatus>
      updateCalendarPreferences: (preferences: Partial<import('shared/calendar').CalendarPreferences>) => Promise<import('shared/calendar').CalendarStatus>
      refreshAppleCalendar: () => Promise<import('shared/calendar').CalendarStatus>
      respondToCalendarEvent: (id: string, action: 'pause' | 'keep') => Promise<void>
      resumeCalendarTracking: () => Promise<void>
      previewCalendarPrompt: () => Promise<void>
      openAppleCalendar: () => Promise<void>
      onAppleCalendarChanged: (callback: () => void) => () => void
      onCalendarRuntimeChanged: (callback: () => void) => () => void
      getDashboardVisibility: () => Promise<boolean>
      onDashboardVisibilityChanged: (callback: (visible: boolean) => void) => () => void
      connectReminders: () => Promise<void>
      disconnectReminders: () => Promise<void>
      refreshReminders: () => Promise<void>
      openReminders: () => Promise<void>
      onRemindersChanged: (callback: (contextChanged: boolean) => void) => () => void
      onActiveWindowChanged: (callback: (details: ActiveWindowDetails) => void) => () => void // Return type for cleanup function
      onActivityCapture: (
        callback: (capture: {
          captureId: string
          sequence: number
          detectedAtMs: number
          committedAtMs: number
          details: ActiveWindowDetails
        }) => void
      ) => () => void
      markActivityPipelineReady: () => void
      acknowledgeActivityCapture: (captureId: string) => void
      // Add the new function's type signature here
      getEnvVariables: () => Promise<{
        isDev: boolean
        LOCAL_MODE: true
        REMINDERS_AVAILABLE: boolean
        SERVER_URL: string
      }>
      // Define other methods of 'api' if you have them
      readFile: (filePath: string) => Promise<ArrayBuffer>
      deleteFile: (filePath: string) => Promise<void>
      getFloatingWindowVisibility: () => Promise<boolean>
      getNotchHelperAvailability: () => Promise<'starting' | 'ready' | 'unavailable'>
      retryNotchHelper: () => void
      setActivityCapturePaused: (paused: boolean) => void
      restartActivityMonitoring: () => Promise<boolean>
      resumeAfterSystemSuspension: () => Promise<{ cleared: boolean; captureScheduled: boolean }>
      resumeManualTracking: () => Promise<{ cleared: boolean; captureScheduled: boolean }>
      refreshCurrentActivity: () => Promise<boolean>
      getAppIconDataUrl: (appName: string) => Promise<string | null>
      getMonitoringHealth: () => Promise<{
        state: 'starting' | 'active' | 'paused' | 'degraded'
        lastNativeDetectionAtMs?: number
        lastDeliveredAtMs?: number
        pendingCaptureId?: string
        lastErrorCode?: string
      }>
      getSystemAccentColor: () => Promise<string | null>
      captureFirefoxNavigation: (state: {
        windowId: number
        title: string
        navigationFingerprint: string
      }) => void
      onFirefoxNavigationState: (
        callback: (state: {
          reason: 'activation' | 'navigation' | 'reload' | 'title_change' | 'content_change'
          navigationFingerprint: string
          pageCorrectionKey: string
          siteIdentity: string | null
          siteHost: string
          pageContent: string | null
        }) => void
      ) => () => void
      onNotchHelperAvailability: (
        callback: (state: 'starting' | 'ready' | 'unavailable') => void
      ) => () => void
      onTempoDesktopCommand: (
        callback: (
          command:
            | 'dashboard'
            | 'analysis'
            | 'settings'
            | 'toggle-sidebar'
            | 'start-focus'
            | 'pause-or-resume'
            | 'set-today-plan'
            | 'set-weekly-focus'
        ) => void
      ) => () => void
      onDisplayRecategorizePage: (callback: (category: Category) => void) => () => void
      onFloatingRecategorizeRequest: (
        callback: (request: {
          requestId: string
          eventIds: string[]
          newCategoryId: string
        }) => void
      ) => () => void
      sendFloatingRecategorizeResult: (result: {
        requestId: string
        ok: boolean
        message?: string
      }) => void
      onFloatingFocusCommand: (
        callback: (command: {
          action: 'pause' | 'resume' | 'skipBreak' | 'endRun' | 'finishTask' | 'extendSession'
          durationMinutes?: number
          noticeId?: string
        }) => void
      ) => () => void
      updateRelevanceEpisode: (
        episode: { key: string; eventId: string; application: string } | null
      ) => void
      onClassificationRelevanceCheck: (callback: (eventId: string) => void) => () => void
      getAudioDataUrl: (sound?: import('shared').DistractionSoundId) => Promise<string | null>
      claimDistractionSound: (
        intervalMs: number
      ) => Promise<import('shared').DistractionSoundPermit>
      openExternalUrl: (url: string) => void
      openFirefoxRuntimeDebugging: () => Promise<string>
      copyFirefoxRuntimeDebuggingAddress: () => void
      revealFirefoxCompanionPackage: () => void
      showNotification: (
        options:
          | {
              kind: 'distraction'
              eventKey: string
              eventId?: string
              intervalMs: number
              showInNotch: boolean
              title: string
              body: string
            }
          | {
              kind: 'session_transition'
              id: string
              title: string
              body: string
              action: 'open_tempo' | 'set_next_goal'
              actionLabel: string
              playFallbackChime: boolean
            }
      ) => void

      // Permission-related methods
      getPermissionRequestStatus: () => Promise<boolean>
      getPermissionStatus: (permissionType: PermissionType) => Promise<PermissionStatus>
      getPermissionsForTitleExtraction: () => Promise<boolean>
      getPermissionsForContentExtraction: () => Promise<boolean>
      requestPermission: (permissionType: PermissionType) => Promise<void>
      forceEnablePermissionRequests: () => Promise<void>
    }
  }
}
