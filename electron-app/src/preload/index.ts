import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'
import { ActiveWindowDetails, Category } from 'shared/dist/types.js'

// Permission types and status enums (match the native layer)
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

export interface PermissionInfo {
  type: PermissionType
  status: PermissionStatus
  name: string
  description: string
}

// Custom APIs for renderer
const api = {
  connectReminders: (): Promise<void> => ipcRenderer.invoke('reminders-connect'),
  disconnectReminders: (): Promise<void> => ipcRenderer.invoke('reminders-disconnect'),
  refreshReminders: (): Promise<void> => ipcRenderer.invoke('reminders-refresh'),
  openReminders: (): Promise<void> => ipcRenderer.invoke('reminders-open'),
  onRemindersChanged: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('reminders-changed', listener)
    return () => ipcRenderer.removeListener('reminders-changed', listener)
  },
  openExternalUrl: (url: string) => ipcRenderer.send('open-external-url', url),
  openFirefoxRuntimeDebugging: (): Promise<string> =>
    ipcRenderer.invoke('open-firefox-runtime-debugging'),
  copyFirefoxRuntimeDebuggingAddress: () =>
    ipcRenderer.send('copy-firefox-runtime-debugging-address'),
  revealFirefoxCompanionPackage: () => ipcRenderer.send('reveal-firefox-companion-package'),
  onActiveWindowChanged: (callback: (details: ActiveWindowDetails) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, details: ActiveWindowDetails) =>
      callback(details)
    ipcRenderer.on('active-window-changed', listener)
    // Return a cleanup function
    return () => {
      ipcRenderer.removeListener('active-window-changed', listener)
    }
  },
  onActivityCapture: (
    callback: (capture: {
      captureId: string
      sequence: number
      detectedAtMs: number
      committedAtMs: number
      details: ActiveWindowDetails
    }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      capture: {
        captureId: string
        sequence: number
        detectedAtMs: number
        committedAtMs: number
        details: ActiveWindowDetails
      }
    ) => callback(capture)
    ipcRenderer.on('activity-capture', listener)
    return () => ipcRenderer.removeListener('activity-capture', listener)
  },
  markActivityPipelineReady: () => ipcRenderer.send('activity-pipeline-ready'),
  acknowledgeActivityCapture: (captureId: string) =>
    ipcRenderer.send('activity-capture-ack', captureId),
  updateRelevanceEpisode: (episode: { key: string; eventId: string; application: string } | null) =>
    ipcRenderer.send('update-relevance-episode', episode),
  onClassificationRelevanceCheck: (callback: (eventId: string) => void) => {
    const listener = (_event: unknown, eventId: string) => callback(eventId)
    ipcRenderer.on('classification-relevance-check', listener)
    return () => ipcRenderer.removeListener('classification-relevance-check', listener)
  },
  getAudioDataUrl: () => ipcRenderer.invoke('get-audio-data-url'),
  claimDistractionSound: (intervalMs: number) =>
    ipcRenderer.invoke('claim-distraction-sound', intervalMs),
  logToFile: (message: string, data?: object) => ipcRenderer.send('log-to-file', message, data),
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
  ) => {
    ipcRenderer.send('show-notification', options)
  },
  getEnvVariables: () => ipcRenderer.invoke('get-env-vars'),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  onDisplayRecategorizePage: (callback: (categoryDetails?: Category) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, categoryDetails?: Category) =>
      callback(categoryDetails)
    ipcRenderer.on('display-recategorize-page', listener)
    // Return a cleanup function
    return () => {
      ipcRenderer.removeListener('display-recategorize-page', listener)
    }
  },
  onFloatingRecategorizeRequest: (
    callback: (request: { requestId: string; eventIds: string[]; newCategoryId: string }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      request: { requestId: string; eventIds: string[]; newCategoryId: string }
    ) => callback(request)
    ipcRenderer.on('floating-recategorize-request', listener)
    return () => ipcRenderer.removeListener('floating-recategorize-request', listener)
  },
  onFloatingFocusCommand: (
    callback: (command: {
      action: 'pause' | 'resume' | 'skipBreak' | 'endRun' | 'finishTask' | 'extendTask10'
      durationMinutes?: number
    }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      command: {
        action: 'pause' | 'resume' | 'skipBreak' | 'endRun' | 'finishTask' | 'extendTask10'
        durationMinutes?: number
      }
    ) => callback(command)
    ipcRenderer.on('floating-focus-command', listener)
    return () => ipcRenderer.removeListener('floating-focus-command', listener)
  },
  sendFloatingRecategorizeResult: (result: { requestId: string; ok: boolean; message?: string }) =>
    ipcRenderer.send('floating-recategorize-result', result),
  getFloatingWindowVisibility: () => ipcRenderer.invoke('get-floating-window-visibility'),
  getNotchHelperAvailability: (): Promise<'starting' | 'ready' | 'unavailable'> =>
    ipcRenderer.invoke('get-notch-helper-availability'),
  retryNotchHelper: () => ipcRenderer.send('retry-notch-helper'),
  setActivityCapturePaused: (paused: boolean) =>
    ipcRenderer.send('set-activity-capture-paused', paused),
  restartActivityMonitoring: (): Promise<boolean> =>
    ipcRenderer.invoke('restart-activity-monitoring'),
  resumeAfterSystemSuspension: (): Promise<{ cleared: boolean; captureScheduled: boolean }> =>
    ipcRenderer.invoke('resume-after-system-suspension'),
  resumeManualTracking: (): Promise<{ cleared: boolean; captureScheduled: boolean }> =>
    ipcRenderer.invoke('resume-manual-tracking'),
  refreshCurrentActivity: (): Promise<boolean> => ipcRenderer.invoke('refresh-current-activity'),
  getAppIconDataUrl: (appName: string): Promise<string | null> =>
    ipcRenderer.invoke('get-app-icon-data-url', appName),
  getMonitoringHealth: () => ipcRenderer.invoke('get-monitoring-health'),
  getSystemAccentColor: (): Promise<string | null> => ipcRenderer.invoke('get-system-accent-color'),
  captureFirefoxNavigation: (state: {
    windowId: number
    title: string
    navigationFingerprint: string
  }) => ipcRenderer.send('capture-firefox-navigation', state),
  onFirefoxNavigationState: (
    callback: (state: {
      reason: 'activation' | 'navigation' | 'reload' | 'title_change' | 'content_change'
      navigationFingerprint: string
      pageCorrectionKey: string
      siteIdentity: string | null
      siteHost: string
      pageContent: string | null
    }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: {
        reason: 'activation' | 'navigation' | 'reload' | 'title_change' | 'content_change'
        navigationFingerprint: string
        pageCorrectionKey: string
        siteIdentity: string | null
        siteHost: string
        pageContent: string | null
      }
    ) => callback(state)
    ipcRenderer.on('firefox-navigation-state', listener)
    return () => ipcRenderer.removeListener('firefox-navigation-state', listener)
  },
  onNotchHelperAvailability: (callback: (state: 'starting' | 'ready' | 'unavailable') => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: 'starting' | 'ready' | 'unavailable'
    ) => callback(state)
    ipcRenderer.on('notch-helper-availability', listener)
    return () => ipcRenderer.removeListener('notch-helper-availability', listener)
  },
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
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      command:
        | 'dashboard'
        | 'analysis'
        | 'settings'
        | 'toggle-sidebar'
        | 'start-focus'
        | 'pause-or-resume'
        | 'set-today-plan'
        | 'set-weekly-focus'
    ) => callback(command)
    ipcRenderer.on('tempo-desktop-command', listener)
    return () => ipcRenderer.removeListener('tempo-desktop-command', listener)
  },

  // Permission-related methods
  getPermissionRequestStatus: (): Promise<boolean> =>
    ipcRenderer.invoke('get-permission-request-status'),
  getPermissionStatus: (permissionType: PermissionType): Promise<PermissionStatus> =>
    ipcRenderer.invoke('get-permission-status', permissionType),
  getPermissionsForTitleExtraction: (): Promise<boolean> =>
    ipcRenderer.invoke('get-permissions-for-title-extraction'),
  getPermissionsForContentExtraction: (): Promise<boolean> =>
    ipcRenderer.invoke('get-permissions-for-content-extraction'),
  requestPermission: (permissionType: PermissionType): Promise<void> =>
    ipcRenderer.invoke('request-permission', permissionType),
  forceEnablePermissionRequests: (): Promise<void> =>
    ipcRenderer.invoke('force-enable-permission-requests')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
