import { app } from 'electron'
import fs from 'fs'
import { join } from 'path'
import { nativeWindows } from '../native-modules/native-windows'

interface BrowserTrackingPrefs {
  chromeTrackingEnabled: boolean
}

const prefsPath = () => join(app.getPath('userData'), 'browser-tracking.json')

function readPrefs(): BrowserTrackingPrefs {
  try {
    const parsed = JSON.parse(fs.readFileSync(prefsPath(), 'utf8'))
    return { chromeTrackingEnabled: parsed?.chromeTrackingEnabled !== false }
  } catch {
    return { chromeTrackingEnabled: true }
  }
}

export function getChromeTrackingEnabled(): boolean {
  return readPrefs().chromeTrackingEnabled
}

export function setChromeTrackingEnabled(enabled: boolean): boolean {
  const next = enabled !== false
  try {
    fs.writeFileSync(prefsPath(), JSON.stringify({ chromeTrackingEnabled: next }), { mode: 0o600 })
  } catch {
    // Still apply for this session if persisting fails.
  }
  nativeWindows.setChromeTrackingEnabled(next)
  return next
}

/** Applies the saved preference to the native layer; call before monitoring starts. */
export function applyChromeTrackingPreference(): void {
  nativeWindows.setChromeTrackingEnabled(readPrefs().chromeTrackingEnabled)
}
