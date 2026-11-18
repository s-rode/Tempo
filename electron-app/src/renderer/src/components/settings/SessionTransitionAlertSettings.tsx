import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../utils/trpc'
import { Switch } from '../ui/switch'
import { SettingsRow, SettingsSection } from './SettingsLayout'

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
    <SettingsSection
      title="Session transitions"
      description="Natural focus and Pomodoro boundaries, in the notch and Notification Center."
    >
      <SettingsRow
        title="Show transition alerts"
        htmlFor="session-transition-alerts"
        description="A 10-second notch card and one actionable notification."
        control={
          <Switch
            id="session-transition-alerts"
            size="sm"
            checked={enabled}
            disabled={update.isLoading}
            onCheckedChange={(next) => {
              setEnabled(next)
              updateLocally({ sessionTransitionAlerts: next })
            }}
          />
        }
      />
      <SettingsRow
        title="Play completion chime"
        htmlFor="session-transition-chime"
        description="One short system chime at each boundary."
        inactive={!enabled}
        control={
          <Switch
            id="session-transition-chime"
            size="sm"
            checked={chime}
            disabled={!enabled || update.isLoading}
            onCheckedChange={(next) => {
              setChime(next)
              updateLocally({ playSessionTransitionChime: next })
            }}
          />
        }
      />
    </SettingsSection>
  )
}
