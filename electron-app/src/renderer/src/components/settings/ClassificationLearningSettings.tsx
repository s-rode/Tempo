import { Brain, Trash2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../utils/trpc'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'

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
  return (
    <section className="tempo-settings-row items-start max-md:flex-col">
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2">
          <Brain className="h-4 w-4" aria-hidden="true" />
          Classification learning
        </h2>
        <p>
          Explicit corrections teach Tempo about this task and similar work in the same list.
          Ignored alerts never count as confirmation.
        </p>
      </div>
      <div className="w-[360px] max-w-full shrink-0">
        <label className="flex min-h-8 items-center justify-between gap-3 text-sm">
          <span>Learn from my corrections</span>
          <Switch
            checked={enabled}
            disabled={busy}
            aria-label="Learn from my corrections"
            onCheckedChange={(value) => update.mutate({ token, learnFromCorrections: value })}
          />
        </label>
        {enabled && (
          <>
            {preferences.isLoading && (
              <p className="py-3 text-xs" role="status">
                Loading preferences…
              </p>
            )}
            {preferences.data?.length === 0 && (
              <p className="py-3 text-xs text-muted-foreground">
                No active preferences yet. Corrections first apply to their original task.
              </p>
            )}
            <ul
              className="mt-3 max-h-80 space-y-2 overflow-y-auto"
              aria-label="Scoped classification preferences"
            >
              {preferences.data?.map((preference) => (
                <li key={preference.id} className="rounded-md border p-2.5">
                  <p className="text-xs font-medium break-words">
                    {preference.toolLabel} · {preference.state === 'focused' ? 'Work' : 'Off task'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground break-words">
                    {preference.scope === 'list' ? 'List' : 'Task'}: {preference.scopeLabel}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {preference.actions} explicit actions · expires{' '}
                    {new Date(preference.expiresAtMs).toLocaleDateString()}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {preference.conflicted
                      ? 'Suspended: explicit feedback conflicts or you paused this preference.'
                      : 'Applies only to the matching context and compatible work method. Visible unrelated activity overrides broad trust.'}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
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
                      size="sm"
                      disabled={busy}
                      aria-label={`Forget ${preference.toolLabel} preference for ${preference.scopeLabel}`}
                      onClick={() =>
                        manage.mutate({ token, preferenceId: preference.id, state: 'removed' })
                      }
                    >
                      <Trash2 className="mr-1 h-3 w-3" aria-hidden="true" />
                      Forget
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {Boolean(preferences.data?.length) && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
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
                Clear learned preferences
              </Button>
            )}
          </>
        )}
        {(preferences.error || manage.error || update.error || clear.error) && (
          <p className="mt-2 text-xs" role="alert">
            Could not update classification learning. Please try again.
          </p>
        )}
      </div>
    </section>
  )
}
