import { BellRing, Volume2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../utils/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'

/** Focus-boundary feedback is intentionally separate from distraction nudges. */
export function SessionTransitionAlertSettings() {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const { data: settings } = trpc.user.getElectronAppSettings.useQuery(
    { token: token || '' },
    { enabled: !!token }
  )
  const update = trpc.user.updateElectronAppSettings.useMutation({
    onSuccess: () => void utils.user.getElectronAppSettings.invalidate()
  })
  const [enabled, setEnabled] = useState(true)
  const [chime, setChime] = useState(true)

  useEffect(() => {
    setEnabled(settings?.sessionTransitionAlerts !== false)
    setChime(settings?.playSessionTransitionChime !== false)
  }, [settings?.sessionTransitionAlerts, settings?.playSessionTransitionChime])

  if (!token) return null
  const updateLocally = (patch: {
    sessionTransitionAlerts?: boolean
    playSessionTransitionChime?: boolean
  }) => {
    utils.user.getElectronAppSettings.setData({ token }, (current) =>
      current ? { ...current, ...patch } : current
    )
    update.mutate({ token, ...patch })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session transition alerts</CardTitle>
        <CardDescription>
          Surface natural focus and Pomodoro boundaries in the notch and Notification Center.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <BellRing className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-0.5">
              <Label htmlFor="session-transition-alerts" className="text-sm font-medium">
                Show transition alerts
              </Label>
              <p className="text-xs text-muted-foreground">
                Shows a 10-second notch card and one actionable system notification.
              </p>
            </div>
          </div>
          <Switch
            id="session-transition-alerts"
            checked={enabled}
            disabled={update.isLoading}
            onCheckedChange={(next) => {
              setEnabled(next)
              updateLocally({ sessionTransitionAlerts: next })
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-t pt-3">
          <div className="flex min-w-0 items-start gap-3">
            <Volume2 className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-0.5">
              <Label htmlFor="session-transition-chime" className="text-sm font-medium">
                Play completion chime
              </Label>
              <p className="text-xs text-muted-foreground">
                A single short system chime for each natural session boundary.
              </p>
            </div>
          </div>
          <Switch
            id="session-transition-chime"
            checked={chime}
            disabled={!enabled || update.isLoading}
            onCheckedChange={(next) => {
              setChime(next)
              updateLocally({ playSessionTransitionChime: next })
            }}
          />
        </div>
      </CardContent>
    </Card>
  )
}
