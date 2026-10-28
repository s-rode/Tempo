import { startCalendarIntegration } from './calendar'
import { runtime } from './runtime'
import { is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, screen, session } from 'electron'
import { ActiveWindowDetails } from 'shared/dist/types.js'
import { nativeWindows } from '../native-modules/native-windows'
import { registerIpcHandlers } from './ipc'
import { initializeLoggers } from './logging'
import {
  getUrlToHandleOnReady,
  handleAppUrl,
  setupProtocolHandlers,
  setupSingleInstanceLock
} from './protocol'
import { createMainWindow } from './windows'
import { ensureLocalServer, stopLocalServer } from './localServer'
import { NotchHelper } from './notchHelper'
import { FirefoxNavigationBridge } from './firefoxNavigationBridge'
import { ActivityMonitoringCoordinator } from './activityMonitoringCoordinator'
import { installTempoMenu } from './menu'
import { startReminderIntegration } from './reminders'

let mainWindow: BrowserWindow | null
let notchHelper: NotchHelper | null
let firefoxNavigationBridge: FirefoxNavigationBridge | null
let monitoring: ActivityMonitoringCoordinator | null
let isQuitting = false
let stopReminders: (() => void) | undefined
let stopCalendars: (() => void) | undefined

function App() {
  async function initializeApp() {
    await initializeLoggers()

    if (!setupSingleInstanceLock(() => mainWindow)) {
      return
    }

    // Set a different AppUserModelId for development to allow dev and prod to run side-by-side.
    if (is.dev) {
      app.setAppUserModelId('com.tempo.local.dev')
    } else {
      app.setAppUserModelId('com.tempo.local')
    }

    if (process.platform === 'darwin') {
      await app.dock?.show()
    }
    app.setName('Tempo')

    {
      const started = await ensureLocalServer()
      if (!started) console.error('Tempo Local server did not become ready before UI startup.')
    }

    setupCsp()
    setupProtocolHandlers(() => mainWindow)

    mainWindow = createMainWindow(
      getUrlToHandleOnReady,
      (url, window) => handleAppUrl(url, window),
      () => isQuitting
    )
    installTempoMenu(() => mainWindow)
    notchHelper = new NotchHelper(() => mainWindow)
    await notchHelper.start()
    firefoxNavigationBridge = new FirefoxNavigationBridge(
      () => mainWindow,
      (state) => {
        nativeWindows.setFirefoxNavigationState({
          windowId: state.windowId,
          title: state.title,
          navigationFingerprint: state.navigationFingerprint,
          pageCorrectionKey: state.pageCorrectionKey
        })
      },
      (connected) => nativeWindows.setFirefoxCompanionConnected(connected)
    )
    if (!runtime.test) firefoxNavigationBridge.start()

    const refreshNotchGeometry = () => notchHelper?.refreshGeometry()
    screen.on('display-added', refreshNotchGeometry)
    screen.on('display-removed', refreshNotchGeometry)
    screen.on('display-metrics-changed', refreshNotchGeometry)

    mainWindow.on('closed', () => {
      mainWindow = null
    })

    monitoring = new ActivityMonitoringCoordinator(
      () => mainWindow,
      (state) => {
        notchHelper?.setSystemSuspension(state)
      }
    )
    registerIpcHandlers({ mainWindow }, notchHelper, monitoring)
    monitoring.start()
    stopReminders = startReminderIntegration()
    stopCalendars = startCalendarIntegration(notchHelper, monitoring)

    // Handle app activation (e.g., clicking the dock icon on macOS)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(
          getUrlToHandleOnReady,
          (url, window) => handleAppUrl(url, window),
          () => isQuitting
        )
      } else if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      }
    })
  }

  function setupCsp() {
    const devServerURL = is.dev
      ? new URL(process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173').origin
      : ''
    const devSocketURL = devServerURL.replace(/^http/, 'ws')
    const serverUrl = runtime.serverUrl
    const csp = `default-src 'self'; script-src 'self' 'unsafe-eval' ${is.dev ? "'unsafe-inline' " + devServerURL : ''}; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' data:; img-src 'self' data:; connect-src 'self' ${serverUrl} ${is.dev ? `${devServerURL} ${devSocketURL}` : ''}`

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
          'Cross-Origin-Opener-Policy': ['unsafe-none']
        }
      })
    })
  }

  app.whenReady().then(initializeApp)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', () => {
    isQuitting = true
    stopReminders?.()
    stopCalendars?.()
    monitoring?.stop()
    notchHelper?.stop()
    firefoxNavigationBridge?.stop()
    stopLocalServer()
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
}

App()
