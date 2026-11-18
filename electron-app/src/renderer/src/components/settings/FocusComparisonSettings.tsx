import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../hooks/use-toast'
import { trpc } from '../../utils/trpc'
import { SettingsRow } from './SettingsLayout'

type FocusComparisonMode = 'all_active_days' | 'same_day_type' | 'same_weekday'

const options: Array<{ value: FocusComparisonMode; title: string; description: string }> = [
  {
    value: 'all_active_days',
    title: 'Recent active days',
    description: 'Your most recent tracked days.'
  },
  {
    value: 'same_day_type',
    title: 'Same kind of day',
    description: 'Weekdays are compared with weekdays, weekends with weekends.'
  },
  {
    value: 'same_weekday',
    title: 'Same weekday',
    description: 'Earlier occurrences of this weekday.'
  }
]

const isFocusComparisonMode = (value: unknown): value is FocusComparisonMode =>
  options.some((option) => option.value === value)

export function FocusComparisonSettings() {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const { data: settings } = trpc.user.getElectronAppSettings.useQuery(
    { token: token || '' },
    { enabled: !!token }
  )
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
          toast({
            title: 'Could not save focus comparison',
            description: 'Tempo kept your previous comparison setting.',
            variant: 'destructive'
          })
        }
      }
    )
  }

  const selected = options.find((option) => option.value === mode) ?? options[0]
  return (
    <SettingsRow
      title="Compare today with"
      htmlFor="focus-comparison-mode"
      description={`${selected.description} Used for “Usual by now” in Today, clipped to the current time of day.`}
      control={
        <select
          id="focus-comparison-mode"
          className="tempo-pref-select"
          value={mode}
          disabled={update.isLoading}
          onChange={(event) => chooseMode(event.target.value as FocusComparisonMode)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.title}
            </option>
          ))}
        </select>
      }
    />
  )
}
