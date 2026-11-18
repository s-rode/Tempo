import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../utils/trpc'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { SettingsRow, SettingsSection, SettingsSegmented } from './SettingsLayout'

type TimerMode = 'streak' | 'workday'
type ToggleKey = 'animateNotchTimerDigits' | 'notchTimerShowSeconds'

const MODES: ReadonlyArray<{ value: TimerMode; label: string }> = [
  { value: 'streak', label: 'Current streak' },
  { value: 'workday', label: 'Workday totals' }
]

const MODE_DESCRIPTIONS: Record<TimerMode, string> = {
  streak: 'The counters reset after one minute of distraction.',
  workday: 'The counters add up focused and distracted time since 06:00.'
}

export function TimerDisplaySettings() {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const { data: settings } = trpc.user.getElectronAppSettings.useQuery(
    { token: token || '' },
    { enabled: !!token }
  )
  const update = trpc.user.updateElectronAppSettings.useMutation({
    onSuccess: () => utils.user.getElectronAppSettings.invalidate()
  })
  const [mode, setMode] = useState<TimerMode>('streak')
  const [animateDigits, setAnimateDigits] = useState(false)
  const [showSeconds, setShowSeconds] = useState(true)
  useEffect(() => {
    if (settings?.notchTimerMode === 'streak' || settings?.notchTimerMode === 'workday')
      setMode(settings.notchTimerMode)
  }, [settings?.notchTimerMode])
  useEffect(() => {
    setAnimateDigits(settings?.animateNotchTimerDigits === true)
  }, [settings?.animateNotchTimerDigits])
  useEffect(() => {
    setShowSeconds(settings?.notchTimerShowSeconds !== false)
  }, [settings?.notchTimerShowSeconds])
  if (!token) return null

  const changeMode = (next: TimerMode) => {
    setMode(next)
    update.mutate({ token, notchTimerMode: next })
  }
  const changeToggle = (key: ToggleKey, next: boolean, setLocal: (value: boolean) => void) => {
    const previous = !next
    setLocal(next)
    utils.user.getElectronAppSettings.setData({ token }, (current) =>
      current ? { ...current, [key]: next } : current
    )
    update.mutate(
      { token, [key]: next },
      {
        onError: () => {
          setLocal(previous)
          utils.user.getElectronAppSettings.setData({ token }, (current) =>
            current ? { ...current, [key]: previous } : current
          )
        }
      }
    )
  }

  return (
    <SettingsSection title="Notch timers">
      <SettingsRow
        title="Counters show"
        description={MODE_DESCRIPTIONS[mode]}
        control={
          <SettingsSegmented
            aria-label="What the notch counters show"
            value={mode}
            options={MODES}
            onChange={changeMode}
          />
        }
      />
      {mode === 'workday' && (
        <SettingsRow
          title="Workday counters"
          description="Start today’s totals from zero. Activity history is kept."
          control={
            <Button
              variant="glass"
              size="compact"
              disabled={update.isLoading}
              onClick={() => {
                if (
                  window.confirm(
                    'Reset the visible workday counters? Activity history will be kept.'
                  )
                )
                  update.mutate({ token, resetWorkdayTimer: true })
              }}
            >
              Reset…
            </Button>
          }
        />
      )}
      <SettingsRow
        title="Show seconds"
        htmlFor="show-notch-timer-seconds"
        description="Turn off to show whole minutes only, such as 12m, which is calmer."
        control={
          <Switch
            id="show-notch-timer-seconds"
            size="sm"
            checked={showSeconds}
            disabled={update.isLoading}
            onCheckedChange={(next) => changeToggle('notchTimerShowSeconds', next, setShowSeconds)}
          />
        }
      />
      <SettingsRow
        title="Animate digits"
        htmlFor="animate-notch-timer-digits"
        description="Off by default to save energy. The timers still update every second."
        control={
          <Switch
            id="animate-notch-timer-digits"
            size="sm"
            checked={animateDigits}
            disabled={update.isLoading}
            onCheckedChange={(next) =>
              changeToggle('animateNotchTimerDigits', next, setAnimateDigits)
            }
          />
        }
      />
    </SettingsSection>
  )
}
