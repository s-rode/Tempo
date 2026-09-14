import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../hooks/use-toast'
import { trpc } from '../../utils/trpc'

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
    <section className="tempo-settings-row items-start">
      <div className="min-w-0 flex-1">
        <h2>Classifier strictness</h2>
        <p>{selected.description} Manual corrections always take priority.</p>
      </div>
      <div className="w-[280px] shrink-0" aria-busy={update.isLoading}>
        <input
          className="tempo-strictness-slider w-full accent-primary"
          type="range"
          min="0"
          max="2"
          step="1"
          value={indexFor(value)}
          disabled={update.isLoading}
          aria-label="Classifier strictness"
          aria-valuetext={selected.title}
          onChange={(event) => choose(options[Number(event.target.value)].value)}
        />
        <div className="mt-1 grid grid-cols-3 text-[11px] text-muted-foreground">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={update.isLoading}
              onClick={() => choose(option.value)}
              className={`rounded px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                value === option.value ? 'font-medium text-foreground' : 'hover:text-foreground'
              } ${option.value === 'flexible' ? 'text-left' : option.value === 'strict' ? 'text-right' : 'text-center'}`}
            >
              {option.title}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
