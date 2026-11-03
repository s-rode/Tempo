import { useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../hooks/use-toast'
import { trpc } from '../../utils/trpc'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'

type RuleState = 'productive' | 'unproductive'
interface AppRule {
  appKey: string
  appName: string
  state: RuleState
}

const MAX_RULES = 50
const keyOf = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
const STATES: Array<{ value: RuleState; label: string }> = [
  { value: 'productive', label: 'Productive' },
  { value: 'unproductive', label: 'Unproductive' }
]

export function AppRulesSettings() {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const { data: settings } = trpc.user.getElectronAppSettings.useQuery(
    { token: token || '' },
    { enabled: Boolean(token) }
  )
  const startOfToday = useMemo(() => new Date().setHours(0, 0, 0, 0), [])
  const { data: recentEvents } = trpc.activeWindowEvents.getEventsForDateRange.useQuery(
    { token: token || '', startDateMs: startOfToday, endDateMs: startOfToday + 86_400_000 },
    { enabled: Boolean(token) }
  )
  const update = trpc.user.updateElectronAppSettings.useMutation({
    onSuccess: () => {
      void utils.user.getElectronAppSettings.invalidate()
      // A new stable capture applies the rules without touching history.
      void window.api?.refreshCurrentActivity()
    },
    onError: (error) =>
      toast({ title: 'Could not save app rules', description: error.message, variant: 'destructive' })
  })
  const [name, setName] = useState('')
  const [newState, setNewState] = useState<RuleState>('productive')

  const rules: AppRule[] = (settings?.appRules as AppRule[] | undefined) ?? []
  const suggestions = useMemo(() => {
    const taken = new Set(rules.map((rule) => rule.appKey))
    const names = new Map<string, string>()
    for (const event of (recentEvents as Array<{ ownerName?: string; type?: string }> | undefined) ??
      []) {
      const owner = event.ownerName?.trim()
      if (owner && event.type !== 'system' && !taken.has(keyOf(owner))) names.set(keyOf(owner), owner)
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b))
  }, [recentEvents, rules])

  if (!token) return null

  const save = (next: Array<Pick<AppRule, 'appName' | 'state'>>) =>
    update.mutate({ token, appRules: next.map(({ appName, state }) => ({ appName, state })) })

  const add = () => {
    const appName = name.trim().replace(/\s+/g, ' ')
    if (!appName || rules.length >= MAX_RULES) return
    save([...rules.filter((rule) => rule.appKey !== keyOf(appName)), { appName, state: newState }])
    setName('')
  }
  const setState = (rule: AppRule, state: RuleState) =>
    save(rules.map((item) => (item.appKey === rule.appKey ? { ...item, state } : item)))
  const remove = (rule: AppRule) => save(rules.filter((item) => item.appKey !== rule.appKey))

  return (
    <Card>
      <CardHeader>
        <CardTitle>App rules</CardTitle>
        <CardDescription>
          Always count an app as productive or unproductive, whatever its window title or your
          current goal. Rules apply to new activity only and override corrections and the AI.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {rules.length === 0 && (
          <p className="text-muted-foreground">No app rules yet. Add the few apps you always want treated the same way.</p>
        )}
        {rules.length > 0 && (
          <ul className="divide-y rounded-lg border" aria-label="App rules">
            {rules.map((rule) => (
              <li key={rule.appKey} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate font-medium">{rule.appName}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span role="group" aria-label={`${rule.appName} classification`} className="flex rounded-md border p-0.5">
                    {STATES.map(({ value, label }) => (
                      <Button
                        key={value}
                        type="button"
                        size="sm"
                        variant={rule.state === value ? 'secondary' : 'ghost'}
                        className="h-7 px-2.5"
                        aria-pressed={rule.state === value}
                        disabled={update.isLoading}
                        onClick={() => rule.state !== value && setState(rule, value)}
                      >
                        {label}
                      </Button>
                    ))}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2.5"
                    aria-label={`Remove rule for ${rule.appName}`}
                    disabled={update.isLoading}
                    onClick={() => remove(rule)}
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            add()
          }}
        >
          <Input
            list="app-rule-suggestions"
            value={name}
            maxLength={120}
            className="h-8 min-w-48 flex-1"
            placeholder="App name, e.g. RemNote"
            aria-label="App name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setName('')}
          />
          <datalist id="app-rule-suggestions">
            {suggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
          <span role="group" aria-label="New rule classification" className="flex rounded-md border p-0.5">
            {STATES.map(({ value, label }) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={newState === value ? 'secondary' : 'ghost'}
                className="h-7 px-2.5"
                aria-pressed={newState === value}
                onClick={() => setNewState(value)}
              >
                {label}
              </Button>
            ))}
          </span>
          <Button
            type="submit"
            size="sm"
            disabled={!name.trim() || update.isLoading || rules.length >= MAX_RULES}
          >
            Add rule
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Use the app's name as Tempo shows it in your timeline. Matching ignores letter case.
        </p>
      </CardContent>
    </Card>
  )
}
