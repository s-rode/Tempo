import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../hooks/use-toast'
import { trpc } from '../../utils/trpc'
import { SettingsRow, SettingsSegmented } from './SettingsLayout'

type Strictness = 'flexible' | 'balanced' | 'strict'

const options: Array<{ value: Strictness; title: string; description: string }> = [
  {
    value: 'flexible',
    title: 'Flexible',
    description: 'Trust grounded semantic links and close learned work patterns.'
  },
  {
    value: 'balanced',
    title: 'Balanced',
    description: 'Require a clear semantic or visibly supporting connection.'
  },
  {
    value: 'strict',
    title: 'Strict',
    description: 'Require strong visible evidence before calling work focused.'
  }
]

const indexFor = (value: Strictness) => options.findIndex((option) => option.value === value)
const isStrictness = (value: unknown): value is Strictness =>
  options.some((option) => option.value === value)

export function ClassifierStrictnessSettings() {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const { data: settings } = trpc.user.getElectronAppSettings.useQuery(
    { token: token || '' },
    { enabled: Boolean(token) }
  )
  const [value, setValue] = useState<Strictness>('strict')
  const update = trpc.user.updateElectronAppSettings.useMutation({
    onSuccess: () => {
      void utils.user.getElectronAppSettings.invalidate()
      void utils.activeWindowEvents.getLatestEvent.invalidate()
      // A new stable capture applies the selected policy without touching history.
      void window.api?.refreshCurrentActivity()
    }
  })

  useEffect(() => {
    if (isStrictness(settings?.classifierStrictness)) setValue(settings.classifierStrictness)
  }, [settings?.classifierStrictness])

  if (!token) return null

  const choose = (next: Strictness) => {
    if (next === value || update.isLoading) return
    const previous = value
    setValue(next)
    utils.user.getElectronAppSettings.setData({ token }, (current) =>
      current ? { ...current, classifierStrictness: next } : current
    )
    update.mutate(
      { token, classifierStrictness: next },
      {
        onError: () => {
          setValue(previous)
          utils.user.getElectronAppSettings.setData({ token }, (current) =>
            current ? { ...current, classifierStrictness: previous } : current
          )
          toast({
            title: 'Could not save classifier strictness',
            description: 'Tempo kept your previous evidence policy.',
            variant: 'destructive'
          })
        }
      }
    )
  }

  const selected = options[indexFor(value)]
  return (
    <SettingsRow
      title="Strictness"
      description={`${selected.description} Manual corrections always take priority.`}
      control={
        <SettingsSegmented
          aria-label="Classifier strictness"
          value={value}
          options={options.map((option) => ({ value: option.value, label: option.title }))}
          disabled={update.isLoading}
          onChange={choose}
        />
      }
    />
  )
}
