import { is } from '@electron-toolkit/utils'
import { app, BrowserWindow } from 'electron'

const scheme = 'tempo:'
let pendingUrl: string | null = null

function isTempoUrl(value: string): boolean {
  try { return new URL(value).protocol === scheme } catch { return false }
}

export function handleAppUrl(url: string, window: BrowserWindow | null): void {
  if (!isTempoUrl(url)) return
  if (!window || window.isDestroyed()) {
    pendingUrl = url
    return
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export function setupProtocolHandlers(getWindow: () => BrowserWindow | null): void {
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleAppUrl(url, getWindow())
  })
  pendingUrl = process.argv.find(isTempoUrl) || null
}

export function getUrlToHandleOnReady(): string | null {
  const next = pendingUrl
  pendingUrl = null
  return next
}

export function setupSingleInstanceLock(getWindow: () => BrowserWindow | null): boolean {
  if (is.dev) return true
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  app.on('second-instance', (_event, arguments_) => {
    const window = getWindow()
    const url = arguments_.find(isTempoUrl)
    if (url) handleAppUrl(url, window)
    else if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    }
  })
  return true
}
