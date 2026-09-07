import { Loader2, Trash2 } from 'lucide-react'
import { toast } from '../../hooks/use-toast'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../utils/trpc'
import { Button } from '../ui/button'

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
    <section className="tempo-settings-row items-start max-md:flex-col">
      <div>
        <h2>Remembered corrections</h2>
        <p>
          Tempo remembers a corrected browser page only while the same effective goal is active.
          Page addresses and captured text are never shown or stored here.
        </p>
      </div>
      <div className="w-[340px] max-w-full shrink-0">
        {corrections.isLoading ? (
          <p className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading corrections…
          </p>
        ) : remembered.length === 0 ? (
          <p className="py-1 text-xs text-muted-foreground">No remembered corrections yet.</p>
        ) : (
          <>
            <ul
              className="overflow-hidden rounded-md border bg-background"
              aria-label="Remembered corrections"
            >
              {remembered.map((correction) => (
                <li
                  key={correction.id}
                  className="flex min-h-11 items-center gap-2 border-b px-2.5 last:border-b-0"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: correction.categoryColor || 'hsl(var(--muted-foreground))'
                    }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1 py-1.5">
                    <p className="truncate text-xs font-medium text-foreground">
                      {correction.label}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {correction.categoryName} ·{' '}
                      {correction.scope === 'page_goal' ? 'Page for this goal' : 'Exact activity'}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={() => removeRule(correction.id, correction.label)}
                    aria-label={`Remove remembered correction for ${correction.label}`}
                    title="Remove remembered correction"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-end">
              <Button
                variant="outline"
                size="xs"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      'Clear all remembered corrections? Future activities will be classified normally.'
                    )
                  ) {
                    clear.mutate({ token })
                  }
                }}
              >
                Clear remembered corrections
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
