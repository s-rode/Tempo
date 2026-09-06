import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../utils/trpc'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'

export function TimerDisplaySettings() {
  const { token } = useAuth()
  const { data: settings } = trpc.user.getElectronAppSettings.useQuery({ token: token || '' }, { enabled: !!token })
  const utils = trpc.useContext()
  const update = trpc.user.updateElectronAppSettings.useMutation({ onSuccess: () => utils.user.getElectronAppSettings.invalidate() })
  const [mode, setMode] = useState<'streak' | 'workday'>('streak')
  const [animateDigits, setAnimateDigits] = useState(true)
  useEffect(() => { if (settings?.notchTimerMode === 'streak' || settings?.notchTimerMode === 'workday') setMode(settings.notchTimerMode) }, [settings])
  useEffect(() => { setAnimateDigits(settings?.animateNotchTimerDigits !== false) }, [settings?.animateNotchTimerDigits])
  if (!token) return null
  const changeMode = (next: 'streak' | 'workday') => {
    setMode(next)
    update.mutate({ token, notchTimerMode: next })
  }
  const changeDigitAnimation = (next: boolean) => {
    const previous = animateDigits
    setAnimateDigits(next)
    utils.user.getElectronAppSettings.setData({ token }, current => current ? { ...current, animateNotchTimerDigits: next } : current)
    update.mutate(
      { token, animateNotchTimerDigits: next },
      {
        onError: () => {
          setAnimateDigits(previous)
          utils.user.getElectronAppSettings.setData({ token }, current => current ? { ...current, animateNotchTimerDigits: previous } : current)
        }
      }
    )
  }
  return <Card>
    <CardHeader><CardTitle>Notch timers</CardTitle><CardDescription>Choose what the two compact counters represent.</CardDescription></CardHeader>
    <CardContent className="space-y-3 text-sm">
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"><input type="radio" checked={mode === 'streak'} onChange={() => changeMode('streak')} /><span><b>Current streak</b><br /><span className="text-muted-foreground">Resets after one minute of distraction.</span></span></label>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"><input type="radio" checked={mode === 'workday'} onChange={() => changeMode('workday')} /><span><b>Workday totals</b><br /><span className="text-muted-foreground">Accumulated focused and distracted time since 06:00.</span></span></label>
      {mode === 'workday' && <Button variant="outline" disabled={update.isLoading} onClick={() => { if (window.confirm('Reset the visible workday counters? Activity history will be kept.')) update.mutate({ token, resetWorkdayTimer: true }) }}>Reset workday counters</Button>}
      <div className="flex items-center justify-between gap-4 border-t pt-3">
        <div className="space-y-0.5"><Label htmlFor="animate-notch-timer-digits" className="text-sm font-medium">Animate timer digits</Label><p className="text-xs text-muted-foreground">Use the native Clock-style motion for the compact notch counters.</p></div>
        <Switch id="animate-notch-timer-digits" checked={animateDigits} disabled={update.isLoading} onCheckedChange={changeDigitAnimation} />
      </div>
    </CardContent>
  </Card>
}
