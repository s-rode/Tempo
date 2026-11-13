import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'

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
    void window.api.setChromeTrackingEnabled(next).then(setChromeEnabled, () => setChromeEnabled(previous))
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Chrome tracking</CardTitle>
        <CardDescription>
          Tempo reads Chrome's current tab with AppleScript every 1.5 seconds while Chrome is in front.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="chrome-tracking" className="text-sm font-medium">
              Track Chrome tabs
            </Label>
            <p className="text-xs text-muted-foreground">
              Turn off if you don't use Chrome. Chrome is then treated like any other app (window title only) and Tempo never sends it AppleScript. Firefox and Safari are unaffected.
            </p>
          </div>
          <Switch
            id="chrome-tracking"
            checked={chromeEnabled !== false}
            disabled={chromeEnabled === null}
            onCheckedChange={change}
          />
        </div>
      </CardContent>
    </Card>
  )
}
