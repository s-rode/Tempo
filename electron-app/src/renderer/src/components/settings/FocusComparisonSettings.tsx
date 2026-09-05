import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../hooks/use-toast'
import { trpc } from '../../utils/trpc'

type FocusComparisonMode = 'all_active_days' | 'same_day_type' | 'same_weekday'

const options: Array<{ value: FocusComparisonMode; title: string; description: string }> = [
  {
    value: 'all_active_days',
    title: 'Average active day',
    description: 'Compare with your most recent tracked days.'
  },
  {
    value: 'same_day_type',
    title: 'Weekdays and weekends separately',
    description: 'Compare weekdays only with weekdays, and weekends only with weekends.'
  },
  {
    value: 'same_weekday',
    title: 'Same weekday',
    description: 'Compare with earlier occurrences of this weekday.'
  }
]

const isFocusComparisonMode = (value: unknown): value is FocusComparisonMode =>
  options.some((option) => option.value === value)

export function FocusComparisonSettings() {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const { data: settings } = trpc.user.getElectronAppSettings.useQuery({ token: token || '' }, { enabled: !!token })
  const [mode, setMode] = useState<FocusComparisonMode>('all_active_days')
  const update = trpc.user.updateElectronAppSettings.useMutation({
    onSuccess: () => void utils.user.getElectronAppSettings.invalidate()
  })

  useEffect(() => {
    if (isFocusComparisonMode(settings?.focusComparisonMode)) {
      setMode(settings.focusComparisonMode)
    }
  }, [settings?.focusComparisonMode])

  if (!token) return null

  const chooseMode = (nextMode: FocusComparisonMode) => {
    const previousMode = mode
    setMode(nextMode)
    update.mutate(
      { token, focusComparisonMode: nextMode },
      {
        onError: () => {
          setMode(previousMode)
          toast({ title: 'Could not save focus comparison', description: 'Tempo kept your previous comparison setting.', variant: 'destructive' })
        }
      }
    )
  }

  return (
    <section className="tempo-settings-row items-start">
      <div>
        <h2>Focus comparison</h2>
        <p>Choose which earlier days Tempo uses for the “Usual by now” comparison in Today. Every sample is clipped to the current time of day.</p>
      </div>
      <fieldset className="w-[310px] shrink-0 space-y-1.5" disabled={update.isLoading}>
        <legend className="sr-only">Focus comparison method</legend>
        {options.map((option) => (
          <label key={option.value} className={`flex cursor-default items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors ${mode === option.value ? 'border-primary/45 bg-accent' : 'border-transparent hover:bg-muted'}`}>
            <input
              type="radio"
              name="focus-comparison-mode"
              value={option.value}
              checked={mode === option.value}
              onChange={() => chooseMode(option.value)}
              className="mt-0.5"
            />
            <span><span className="block text-xs font-medium text-foreground">{option.title}</span><span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{option.description}</span></span>
          </label>
        ))}
      </fieldset>
    </section>
  )
}
