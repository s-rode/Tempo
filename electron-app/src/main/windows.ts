import { is } from '@electron-toolkit/utils'
import { app, BrowserWindow, screen } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'

export function createMainWindow(
  getUrlToHandleOnReady: () => string | null,
  handleAppUrl: (url: string, window: BrowserWindow) => void,
  isQuitting: () => boolean
): BrowserWindow {
  const statePath = join(app.getPath('userData'), 'desktop-window-state.json')
  const fallbackBounds = { width: 1120, height: 760 }
  let restoredBounds = fallbackBounds
  try {
    if (existsSync(statePath)) {
      const candidate = JSON.parse(readFileSync(statePath, 'utf8'))
      const visible = screen.getAllDisplays().some((display) => {
        const { x, y, width, height } = display.workArea
        return (
          candidate.x >= x - candidate.width &&
          candidate.x <= x + width &&
          candidate.y >= y - candidate.height &&
          candidate.y <= y + height
        )
      })
      if (visible && candidate.width >= 960 && candidate.height >= 680) restoredBounds = candidate
    }
  } catch {
    // A window-state failure must never prevent Tempo from opening.
  }
  const mainWindow = new BrowserWindow({
    ...restoredBounds,
    minWidth: 960,
    minHeight: 680,
    show: false,
    frame: true,
    title: 'Tempo',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: false,
    backgroundColor: '#F5F5F7',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      // Classification and system-event commits must continue with the dashboard hidden.
      backgroundThrottling: false
    }
  })

  let dockHideTimer: ReturnType<typeof setTimeout> | undefined
  let lastDockHideAt = 0
  const hideDock = () => {
    if (process.platform !== 'darwin') return
    clearTimeout(dockHideTimer)
    // macOS ignores repeated Dock hides less than a second apart.
    const delay = Math.max(0, 1100 - (Date.now() - lastDockHideAt))
    dockHideTimer = setTimeout(() => {
      if (mainWindow.isDestroyed() || mainWindow.isVisible() || isQuitting()) return
      app.dock?.hide()
      lastDockHideAt = Date.now()
    }, delay)
  }
  mainWindow.on('close', (event) => {
    if (isQuitting()) return
    event.preventDefault()
    mainWindow.hide()
    hideDock()
  })
  mainWindow.on('show', () => {
    clearTimeout(dockHideTimer)
    if (process.platform !== 'darwin' || app.dock?.isVisible()) return
    void app.dock?.show().then(() => {
      if (mainWindow.isDestroyed() || isQuitting()) return
      // Showing the Dock changes activation policy; focus after it finishes.
      if (mainWindow.isVisible()) mainWindow.focus()
      else hideDock()
    })
  })
  mainWindow.on('closed', () => clearTimeout(dockHideTimer))

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const saveWindowState = () => {
    if (mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isMaximized()) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try {
        writeFileSync(statePath, JSON.stringify(mainWindow.getBounds()), { mode: 0o600 })
      } catch {
        // State restoration is a convenience, not a reason to interrupt work.
      }
    }, 250)
  }
  mainWindow.on('resize', saveWindowState)
  mainWindow.on('move', saveWindowState)

  mainWindow.on('ready-to-show', () => mainWindow.show())
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  if (is.dev) mainWindow.webContents.openDevTools()
  let lastRecoveryAt = 0
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (isQuitting() || mainWindow.isDestroyed() || details.reason === 'clean-exit') return
    // A crashed dashboard otherwise leaves the independent notch clock running
    // forever. Bound retries to avoid a reload loop on a persistent failure.
    if (Date.now() - lastRecoveryAt < 30_000) return
    lastRecoveryAt = Date.now()
    mainWindow.webContents.reload()
  })
  mainWindow.webContents.on('did-finish-load', () => {
    const pendingUrl = getUrlToHandleOnReady()
    if (pendingUrl) handleAppUrl(pendingUrl, mainWindow)
  })
  return mainWindow
}
