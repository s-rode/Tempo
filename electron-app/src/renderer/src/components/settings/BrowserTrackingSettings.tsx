import { useEffect, useState } from 'react'
import { Switch } from '../ui/switch'
import { SettingsRow } from './SettingsLayout'

export function BrowserTrackingSettings() {
  const [chromeEnabled, setChromeEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.api?.getChromeTrackingEnabled().then((value) => {
      if (!cancelled) setChromeEnabled(value)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const change = (next: boolean) => {
    const previous = chromeEnabled
    setChromeEnabled(next)
    void window.api
      .setChromeTrackingEnabled(next)
      .then(setChromeEnabled, () => setChromeEnabled(previous))
  }
  return (
    <SettingsRow
      title="Track Google Chrome tabs"
      htmlFor="chrome-tracking"
      description="Reads the front tab with AppleScript every 1.5 seconds while Chrome is active. When off, Chrome is treated like any other app (window title only). Firefox and Safari are unaffected."
      control={
        <Switch
          id="chrome-tracking"
          size="sm"
          checked={chromeEnabled !== false}
          disabled={chromeEnabled === null}
          onCheckedChange={change}
        />
      }
    />
  )
}
