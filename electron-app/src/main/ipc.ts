import { runtime } from './runtime'
import { RelevanceCheckCoordinator } from './relevanceCheckCoordinator'
import { is } from '@electron-toolkit/utils'
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Notification,
  shell,
  systemPreferences
} from 'electron'
import fs from 'fs/promises'
import { join } from 'path'
import { Category } from 'shared/dist/types'
import icon from '../../resources/icon.png?asset'
import { nativeWindows, PermissionType } from '../native-modules/native-windows'
import { logMainToFile } from './logging'
import { FloatingStatusUpdate, NotchHelper } from './notchHelper'
import { ActivityMonitoringCoordinator } from './activityMonitoringCoordinator'
import { DistractionReminderGate } from './distractionNoticePolicy'
import { DistractionSoundGate } from './distractionSoundGate'
import { loadDistractionSound } from './distractionSounds'

interface Windows {
  mainWindow: BrowserWindow | null
}

const FIREFOX_RUNTIME_DEBUGGING_URL = 'about:debugging#/runtime/this-firefox'

type DesktopNotificationRequest =
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

export function registerIpcHandlers(
  windows: Windows,
  notchHelper: NotchHelper,
  monitoring: ActivityMonitoringCoordinator
): void {
  const deliveredSessionNotificationIds = new Set<string>()
  const distractionReminderGate = new DistractionReminderGate()
  const distractionSoundGate = new DistractionSoundGate()
  ipcMain.handle('claim-distraction-sound', (event, intervalMs: number) => {
    if (event.sender !== windows.mainWindow?.webContents)
      return { allowed: false, retryAfterMs: 30_000 }
    return distractionSoundGate.claim(intervalMs)
  })
  const focusMainWindow = (command?: 'start-focus') => {
    const window = windows.mainWindow
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    if (command) window.webContents.send('tempo-desktop-command', command)
  }
  const relevanceChecks = new RelevanceCheckCoordinator((episode) => {
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: 'Is this related to your task?',
      body: `Tempo needs more context for ${episode.application}. Review this activity when convenient.`,
      silent: true,
      actions: [{ type: 'button', text: 'Review activity' }]
    })
    const open = () => {
      focusMainWindow()
      windows.mainWindow?.webContents.send('classification-relevance-check', episode.eventId)
    }
    notification.on('click', open)
    notification.on('action', (_event, index) => {
      if (index === 0) open()
    })
    notification.show()
  })
  ipcMain.on('update-relevance-episode', (event, episode) => {
    if (event.sender !== windows.mainWindow?.webContents) return
    if (episode === null) {
      relevanceChecks.update(null)
      return
    }
    if (
      !episode ||
      typeof episode.key !== 'string' ||
      episode.key.length > 500 ||
      typeof episode.application !== 'string' ||
      episode.application.length > 100 ||
      !/^[a-f0-9]{24}$/.test(episode.eventId || '')
    )
      return
    relevanceChecks.update({
      key: episode.key,
      eventId: episode.eventId,
      application: episode.application
    })
  })
  ipcMain.on('hide-floating-window', () => {
    notchHelper.hide()
  })

  ipcMain.on('show-floating-window', () => {
    if (notchHelper.state === 'unavailable') notchHelper.retry()
    else notchHelper.show()
  })

  ipcMain.handle('set-open-at-login', (_event, enable: boolean) => {
    if (process.platform === 'darwin') {
      app.setLoginItemSettings({
        openAtLogin: enable,
        openAsHidden: true
      })
    }
  })

  ipcMain.handle('enable-permission-requests', () => {
    logMainToFile('Enabling permission requests after onboarding completion')
    nativeWindows.setShouldRequestPermissions(true)
  })

  // Permission-related IPC handlers
  ipcMain.handle('get-permission-request-status', () => {
    return nativeWindows.getShouldRequestPermissions()
  })

  ipcMain.handle('get-permission-status', (_event, permissionType: PermissionType) => {
    return nativeWindows.getPermissionStatus(permissionType)
  })

  ipcMain.handle('get-permissions-for-title-extraction', () => {
    return nativeWindows.hasPermissionsForTitleExtraction()
  })

  ipcMain.handle('get-permissions-for-content-extraction', () => {
    return nativeWindows.hasPermissionsForContentExtraction()
  })

  ipcMain.handle('request-permission', (_event, permissionType: PermissionType) => {
    logMainToFile(`Manually requesting permission: ${permissionType}`)
    nativeWindows.requestPermission(permissionType)
  })

  ipcMain.handle('force-enable-permission-requests', () => {
    logMainToFile('Force enabling permission requests via settings')
    nativeWindows.setShouldRequestPermissions(true)
  })

  ipcMain.on('open-external-url', (_event, url: string) => {
    shell.openExternal(url)
  })

  // `about:` is an internal Firefox address, not an operating-system URL
  // scheme. Passing it to macOS or directly spawning Firefox can start a
  // second profile process on recent Firefox/macOS releases. Focus Firefox
  // through LaunchServices instead; the renderer gives the user a copyable
  // address to paste into their existing, healthy Firefox profile.
  ipcMain.handle('open-firefox-runtime-debugging', () => {
    if (process.platform === 'darwin') return shell.openPath('/Applications/Firefox.app')
    return shell.openExternal('https://developer.mozilla.org/docs/Tools/about:debugging')
  })
  ipcMain.on('copy-firefox-runtime-debugging-address', () => {
    clipboard.writeText(FIREFOX_RUNTIME_DEBUGGING_URL)
  })
  ipcMain.on('reveal-firefox-companion-package', () => {
    const packagePath = app.isPackaged
      ? join(process.resourcesPath, 'firefox-extension', 'Tempo-Firefox-Companion-UNSIGNED.zip')
      : join(app.getAppPath(), 'build-resources', 'Tempo-Firefox-Companion-UNSIGNED.zip')
    shell.showItemInFolder(packagePath)
  })

  ipcMain.handle('get-floating-window-visibility', () => {
    return notchHelper.visible
  })

  ipcMain.handle('get-notch-helper-availability', () => notchHelper.state)
  ipcMain.on('retry-notch-helper', () => notchHelper.retry())

  ipcMain.on('set-activity-capture-paused', (_event, paused: boolean) => {
    monitoring.setPaused(Boolean(paused))
  })
  ipcMain.handle('restart-activity-monitoring', () => monitoring.restart())
  ipcMain.handle('resume-after-system-suspension', () => monitoring.resumeAfterSystemSuspension())
  ipcMain.handle('resume-manual-tracking', () => monitoring.resumeManualTracking())
  ipcMain.handle('refresh-current-activity', () => {
    if (monitoring.getHealth().state !== 'active') return false
    nativeWindows.refreshActiveWindow()
    return true
  })
  ipcMain.handle('get-app-icon-data-url', async (_event, appName: unknown) => {
    if (typeof appName !== 'string' || !appName.trim() || appName.length > 120) return null
    try {
      const iconPath = nativeWindows.getAppIconPath(appName.trim())
      if (!iconPath) return null
      const data = await fs.readFile(iconPath)
      return `data:image/png;base64,${data.toString('base64')}`
    } catch {
      return null
    }
  })
  ipcMain.handle('get-monitoring-health', () => monitoring.getHealth())
  ipcMain.handle('get-system-accent-color', () => {
    if (process.platform !== 'darwin') return null
    const hex = systemPreferences.getAccentColor()
    return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex}` : null
  })
  ipcMain.on('activity-pipeline-ready', () => monitoring.markRendererReady())
  ipcMain.on('activity-capture-ack', (_event, captureId: string) =>
    monitoring.acknowledge(captureId)
  )
  ipcMain.on(
    'capture-firefox-navigation',
    (_event, state: { windowId: number; title: string; navigationFingerprint: string }) => {
      if (
        !state ||
        !Number.isFinite(state.windowId) ||
        !state.title ||
        !/^[a-f0-9]{64}$/.test(state.navigationFingerprint || '')
      )
        return
      nativeWindows.captureFirefoxNavigation(state)
    }
  )

  ipcMain.on('log-to-file', (_event, _message: string, _data?: object) => {
    // logRendererToFile(message, data)
  })

  ipcMain.handle('get-env-vars', () => ({
    isDev: is.dev,
    LOCAL_MODE: true,
    REMINDERS_AVAILABLE: process.platform === 'darwin',
    SERVER_URL: runtime.serverUrl
  }))

  ipcMain.handle('get-audio-data-url', async (_event, sound?: unknown) => {
    try {
      return await loadDistractionSound(sound)
    } catch {
      console.error('Could not load the selected macOS alert sound.')
      return null
    }
  })

  ipcMain.handle('read-file', async (_event, filePath: string) => {
    try {
      const buffer = await fs.readFile(filePath)
      return buffer
    } catch (error) {
      console.error('Error reading file:', error)
      throw error
    }
  })

  ipcMain.handle('delete-file', async (_event, filePath: string) => {
    try {
      await fs.unlink(filePath)
    } catch (error) {
      console.error('Error deleting file via IPC:', error)
    }
  })

  ipcMain.on('update-floating-window-status', (_event, data: FloatingStatusUpdate) => {
    notchHelper.updateStatus(data)
  })

  ipcMain.on('request-recategorize-view', (_event, categoryDetails?: Category) => {
    if (windows.mainWindow) {
      windows.mainWindow.show()
      windows.mainWindow.focus()

      if (windows.mainWindow.isMinimized()) {
        windows.mainWindow.restore()
      }
      windows.mainWindow.webContents.send('display-recategorize-page', categoryDetails)
    } else {
      console.error(
        'Main Process: ERROR: mainWindow is not available when "request-recategorize-view" was received.'
      )
    }
  })

  ipcMain.on(
    'request-floating-recategorization',
    (_event, request: { requestId: string; eventIds: string[]; newCategoryId: string }) => {
      if (!windows.mainWindow || !request?.requestId || request.eventIds.length === 0) return
      windows.mainWindow.webContents.send('floating-recategorize-request', request)
    }
  )

  ipcMain.on(
    'floating-recategorize-result',
    (_event, result: { requestId: string; ok: boolean; message?: string }) => {
      notchHelper.sendRecategorizeResult(result)
    }
  )

  ipcMain.on('open-main-app-window', () => {
    if (windows.mainWindow) {
      windows.mainWindow.show()
      windows.mainWindow.focus()
    }
  })

  ipcMain.on('show-notification', (_event, request: DesktopNotificationRequest) => {
    if (!request || typeof request.title !== 'string' || typeof request.body !== 'string') return
    const isSessionTransition = request.kind === 'session_transition'
    const isDistractionReminder = request.kind === 'distraction'
    if (isDistractionReminder) {
      if (
        !request.eventKey ||
        request.eventKey.length > 160 ||
        !distractionReminderGate.shouldDeliver(request.eventKey, request.intervalMs)
      ) {
        return
      }
      if (request.showInNotch && request.eventId) {
        notchHelper.presentDistractionNotice({
          id: crypto.randomUUID(),
          eventId: request.eventId,
          title: request.title,
          body: request.body,
          occurredAtMs: Date.now()
        })
      }
    }
    if (isSessionTransition) {
      if (deliveredSessionNotificationIds.has(request.id)) return
      deliveredSessionNotificationIds.add(request.id)
      // Bound the in-memory dedupe cache; persistence on the runtime provides
      // the durable part of this protection.
      if (deliveredSessionNotificationIds.size > 64) {
        const oldest = deliveredSessionNotificationIds.values().next().value
        if (oldest) deliveredSessionNotificationIds.delete(oldest)
      }
      if (request.playFallbackChime && notchHelper.state !== 'ready') {
        notchHelper.markTransitionChimeDeliveredElsewhere(request.id)
        shell.beep()
      }
    }
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: request.title,
        body: request.body,
        // Distraction audio has its own user-controlled interval and cooldown.
        silent: isDistractionReminder,
        icon: process.platform === 'win32' ? icon : undefined,
        actions: [
          {
            type: 'button',
            text: isSessionTransition ? request.actionLabel : 'Open Tempo'
          }
        ]
      })

      notification.on('click', () => {
        focusMainWindow(
          isSessionTransition && request.action === 'set_next_goal' ? 'start-focus' : undefined
        )
      })

      notification.on('action', (_event, index) => {
        if (index === 0) {
          focusMainWindow(
            isSessionTransition && request.action === 'set_next_goal' ? 'start-focus' : undefined
          )
        }
      })

      notification.show()
    } else {
      logMainToFile('Notifications not supported on this system.')
    }
  })

  // This is a workaround for the main window's webContents being unavailable
  // when the renderer is ready.
  ipcMain.on('ping', () => console.log('pong'))

  windows.mainWindow?.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}
