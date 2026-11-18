import { Loader2, Trash2 } from 'lucide-react'
import { toast } from '../../hooks/use-toast'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../utils/trpc'
import { Button } from '../ui/button'
import { SettingsPlaceholder, SettingsSection } from './SettingsLayout'

/** A compact, reviewable record of the user’s local correction choices. */
export function RememberedCorrectionsSettings() {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const corrections = trpc.activeWindowEvents.getRememberedCorrections.useQuery(
    { token: token || '' },
    { enabled: !!token }
  )
  const remove = trpc.activeWindowEvents.removeRememberedCorrection.useMutation({
    onSuccess: () => void utils.activeWindowEvents.getRememberedCorrections.invalidate()
  })
  const clear = trpc.activeWindowEvents.clearRememberedCorrections.useMutation({
    onSuccess: (result) => {
      void utils.activeWindowEvents.getRememberedCorrections.invalidate()
      toast({
        title: 'Remembered corrections cleared',
        description:
          result.removedCount === 1
            ? 'Removed 1 correction.'
            : `Removed ${result.removedCount} corrections.`
      })
    }
  })

  if (!token) return null

  const remembered = corrections.data || []
  const busy = remove.isLoading || clear.isLoading
  const removeRule = (id: string, label: string) => {
    remove.mutate(
      { token, id },
      {
        onError: (error) =>
          toast({
            title: 'Could not remove correction',
            description: error.message,
            variant: 'destructive'
          }),
        onSuccess: () =>
          toast({
            title: 'Correction removed',
            description: `${label} will be classified normally next time.`
          })
      }
    )
  }

  return (
    <SettingsSection
      title="Remembered corrections"
      description="A corrected browser page is remembered only while the same goal is active. Page addresses and captured text are never shown or stored here."
      footer={
        remembered.length > 0 && (
          <button
            type="button"
            className="tempo-pref-link"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  'Clear all exact remembered corrections? Learned patterns will remain.'
                )
              )
                clear.mutate({ token })
            }}
          >
            Clear remembered corrections…
          </button>
        )
      }
    >
      {corrections.isLoading ? (
        <SettingsPlaceholder>
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading corrections…
          </span>
        </SettingsPlaceholder>
      ) : remembered.length === 0 ? (
        <SettingsPlaceholder>No remembered corrections yet.</SettingsPlaceholder>
      ) : (
        <ul className="tempo-pref-scroll-list" aria-label="Remembered corrections">
          {remembered.map((correction) => (
            <li key={correction.id} className="tempo-pref-row tempo-pref-list-row">
              <div className="tempo-pref-row-main">
                <span
                  className="tempo-pref-dot"
                  style={{
                    backgroundColor: correction.categoryColor || 'hsl(var(--muted-foreground))'
                  }}
                  aria-hidden="true"
                />
                <div className="tempo-pref-row-text">
                  <div className="tempo-pref-title truncate">{correction.label}</div>
                  <div className="tempo-pref-description truncate">
                    {correction.categoryName} ·{' '}
                    {correction.scope === 'page_goal' ? 'Page for this goal' : 'Exact activity'}
                  </div>
                </div>
                <div className="tempo-pref-control">
                  <Button
                    variant="ghost"
                    size="compact"
                    disabled={busy}
                    onClick={() => removeRule(correction.id, correction.label)}
                    aria-label={`Remove remembered correction for ${correction.label}`}
                    title="Remove"
                    className="tempo-pref-icon-button tempo-pref-danger"
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
