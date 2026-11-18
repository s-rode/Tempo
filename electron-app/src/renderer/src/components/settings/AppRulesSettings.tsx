import { Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../hooks/use-toast'
import { trpc } from '../../utils/trpc'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  SettingsPlaceholder,
  SettingsRow,
  SettingsSection,
  SettingsSegmented
} from './SettingsLayout'

type RuleState = 'productive' | 'unproductive'
interface AppRule {
  appKey: string
  appName: string
  state: RuleState
}

const MAX_RULES = 50
const keyOf = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
const STATES: ReadonlyArray<{ value: RuleState; label: string }> = [
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
      toast({
        title: 'Could not save app rules',
        description: error.message,
        variant: 'destructive'
      })
  })
  const [name, setName] = useState('')
  const [newState, setNewState] = useState<RuleState>('productive')

  const rules: AppRule[] = (settings?.appRules as AppRule[] | undefined) ?? []
  const suggestions = useMemo(() => {
    const taken = new Set(rules.map((rule) => rule.appKey))
    const names = new Map<string, string>()
    for (const event of (recentEvents as
      | Array<{ ownerName?: string; type?: string }>
      | undefined) ?? []) {
      const owner = event.ownerName?.trim()
      if (owner && event.type !== 'system' && !taken.has(keyOf(owner)))
        names.set(keyOf(owner), owner)
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
    <SettingsSection
      title="App rules"
      description="Always count an app the same way, whatever its window title or your goal. Rules override corrections and the AI, for new activity only."
      footer="Use the app’s name as it appears in your timeline. Matching ignores letter case."
    >
      {rules.length === 0 && (
        <SettingsPlaceholder>
          No app rules yet. Add the few apps you always want treated the same way.
        </SettingsPlaceholder>
      )}
      {rules.map((rule) => (
        <SettingsRow
          key={rule.appKey}
          className="tempo-pref-list-row"
          title={<span className="block truncate">{rule.appName}</span>}
          control={
            <>
              <SettingsSegmented
                aria-label={`${rule.appName} classification`}
                value={rule.state}
                options={STATES}
                disabled={update.isLoading}
                onChange={(state) => setState(rule, state)}
              />
              <Button
                type="button"
                size="compact"
                variant="ghost"
                className="tempo-pref-icon-button tempo-pref-danger"
                aria-label={`Remove rule for ${rule.appName}`}
                title="Remove rule"
                disabled={update.isLoading}
                onClick={() => remove(rule)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </>
          }
        />
      ))}
      <form
        className="tempo-pref-row tempo-pref-add-row"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <div className="tempo-pref-row-main">
          <Input
            list="app-rule-suggestions"
            value={name}
            maxLength={120}
            className="tempo-pref-input min-w-0 flex-1"
            placeholder="App name, such as RemNote"
            aria-label="App name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setName('')}
          />
          <datalist id="app-rule-suggestions">
            {suggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
          <div className="tempo-pref-control">
            <SettingsSegmented
              aria-label="New rule classification"
              value={newState}
              options={STATES}
              onChange={setNewState}
            />
            <Button
              type="submit"
              size="compact"
              disabled={!name.trim() || update.isLoading || rules.length >= MAX_RULES}
            >
              Add rule
            </Button>
          </div>
        </div>
      </form>
    </SettingsSection>
  )
}
