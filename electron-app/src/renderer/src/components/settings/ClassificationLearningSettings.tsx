import { Trash2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../utils/trpc'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { SettingsPlaceholder, SettingsRow, SettingsSection } from './SettingsLayout'

/** Explicit, scoped observations; silence and productive time never strengthen trust. */
export function ClassificationLearningSettings() {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const settings = trpc.user.getElectronAppSettings.useQuery(
    { token: token || '' },
    { enabled: Boolean(token) }
  )
  const preferences = trpc.activeWindowEvents.getScopedPreferences.useQuery(
    { token: token || '' },
    { enabled: Boolean(token) }
  )
  const refresh = () => {
    void utils.activeWindowEvents.getScopedPreferences.invalidate()
    void utils.activeWindowEvents.getLatestEvent.invalidate()
    void window.api?.refreshCurrentActivity()
  }
  const update = trpc.user.updateElectronAppSettings.useMutation({
    onSuccess: () => {
      void utils.user.getElectronAppSettings.invalidate()
      refresh()
    }
  })
  const manage = trpc.activeWindowEvents.manageScopedPreference.useMutation({ onSuccess: refresh })
  const clear = trpc.activeWindowEvents.clearLearnedCorrectionPatterns.useMutation({
    onSuccess: refresh
  })
  if (!token) return null
  const enabled = settings.data?.learnFromCorrections !== false
  const busy = update.isLoading || manage.isLoading || clear.isLoading
  const failed = preferences.error || manage.error || update.error || clear.error
  return (
    <SettingsSection
      title="Learning"
      description="Explicit corrections teach Tempo about the task and similar work in the same list. Ignored alerts never count as confirmation."
      footer={
        (failed || (enabled && Boolean(preferences.data?.length))) && (
          <>
            {failed && (
              <p role="alert" className="text-destructive">
                Could not update classification learning. Please try again.
              </p>
            )}
            {enabled && Boolean(preferences.data?.length) && (
              <button
                type="button"
                className="tempo-pref-link"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      'Clear learned preferences? Exact remembered corrections will remain.'
                    )
                  )
                    clear.mutate({ token })
                }}
              >
                Clear learned preferences…
              </button>
            )}
          </>
        )
      }
    >
      <SettingsRow
        title="Learn from my corrections"
        htmlFor="learn-from-corrections"
        control={
          <Switch
            id="learn-from-corrections"
            size="sm"
            checked={enabled}
            disabled={busy}
            onCheckedChange={(value) => update.mutate({ token, learnFromCorrections: value })}
          />
        }
      />
      {enabled && preferences.isLoading && (
        <SettingsPlaceholder>
          <span role="status">Loading preferences…</span>
        </SettingsPlaceholder>
      )}
      {enabled && preferences.data?.length === 0 && (
        <SettingsPlaceholder>
          No learned preferences yet. A correction first applies to its original task.
        </SettingsPlaceholder>
      )}
      {enabled && Boolean(preferences.data?.length) && (
        <ul className="tempo-pref-scroll-list" aria-label="Learned classification preferences">
          {preferences.data?.map((preference) => (
            <li key={preference.id} className="tempo-pref-row tempo-pref-list-row">
              <div className="tempo-pref-row-main">
                <span
                  className="tempo-pref-dot"
                  data-tone={
                    preference.conflicted
                      ? 'muted'
                      : preference.state === 'focused'
                        ? 'good'
                        : 'bad'
                  }
                  aria-hidden="true"
                />
                <div className="tempo-pref-row-text">
                  <div className="tempo-pref-title break-words">
                    {preference.toolLabel} · {preference.state === 'focused' ? 'Work' : 'Off task'}
                  </div>
                  <div className="tempo-pref-description break-words">
                    {preference.scope === 'list' ? 'List' : 'Task'}: {preference.scopeLabel} ·{' '}
                    {preference.actions} explicit actions · expires{' '}
                    {new Date(preference.expiresAtMs).toLocaleDateString()}
                    {preference.conflicted && (
                      <span className="block">
                        Suspended: explicit feedback conflicts or you paused it.
                      </span>
                    )}
                  </div>
                </div>
                <div className="tempo-pref-control">
                  <Button
                    variant="glass"
                    size="compact"
                    disabled={busy}
                    onClick={() =>
                      manage.mutate({
                        token,
                        preferenceId: preference.id,
                        state: preference.conflicted ? 'active' : 'suspended'
                      })
                    }
                  >
                    {preference.conflicted ? 'Reinstate' : 'Suspend'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="compact"
                    className="tempo-pref-icon-button tempo-pref-danger"
                    disabled={busy}
                    title="Forget"
                    aria-label={`Forget ${preference.toolLabel} preference for ${preference.scopeLabel}`}
                    onClick={() =>
                      manage.mutate({ token, preferenceId: preference.id, state: 'removed' })
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  )
}
