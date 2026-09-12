import { Brain, Trash2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../hooks/use-toast'
import { trpc } from '../../utils/trpc'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'

/** Reviewable, local-only generalization from explicit correction feedback. */
export function ClassificationLearningSettings() {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const { data: settings } = trpc.user.getElectronAppSettings.useQuery(
    { token: token || '' },
    { enabled: Boolean(token) }
  )
  const patterns = trpc.activeWindowEvents.getLearnedCorrectionPatterns.useQuery(
    { token: token || '' },
    { enabled: Boolean(token) }
  )
  const update = trpc.user.updateElectronAppSettings.useMutation({
    onSuccess: () => {
      void utils.user.getElectronAppSettings.invalidate()
      void utils.activeWindowEvents.getLatestEvent.invalidate()
      void window.api?.refreshCurrentActivity()
    }
  })
  const remove = trpc.activeWindowEvents.removeLearnedCorrectionPattern.useMutation({
    onSuccess: () => {
      void utils.activeWindowEvents.getLearnedCorrectionPatterns.invalidate()
      void window.api?.refreshCurrentActivity()
    }
  })
  const clear = trpc.activeWindowEvents.clearLearnedCorrectionPatterns.useMutation({
    onSuccess: (result) => {
      void utils.activeWindowEvents.getLearnedCorrectionPatterns.invalidate()
      void window.api?.refreshCurrentActivity()
      toast({
        title: 'Learned patterns cleared',
        description: result.removedCount === 1 ? 'Removed 1 pattern.' : `Removed ${result.removedCount} patterns.`
      })
    }
  })

  if (!token) return null
  const enabled = settings?.learnFromCorrections !== false
  const busy = update.isLoading || remove.isLoading || clear.isLoading
  const learned = patterns.data || []

  return (
    <section className="tempo-settings-row items-start max-md:flex-col">
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Classification learning
        </h2>
        <p>
          Tempo can apply your explicit corrections to closely similar work with the same app or website. It never learns from ignored alerts or uncorrected activity.
        </p>
      </div>
      <div className="w-[340px] max-w-full shrink-0">
        <label className="flex min-h-8 items-center justify-between gap-3 text-sm">
          <span>Learn from my corrections</span>
          <Switch
            checked={enabled}
            disabled={busy}
            aria-label="Learn from my corrections"
            onCheckedChange={(next) =>
              update.mutate(
                { token, learnFromCorrections: next },
                {
                  onError: (error) =>
                    toast({ title: 'Could not update classification learning', description: error.message, variant: 'destructive' })
                }
              )
            }
          />
        </label>
        {enabled && (patterns.isLoading ? (
          <p className="py-3 text-xs text-muted-foreground">Loading local patterns…</p>
        ) : learned.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">No learned patterns yet. Correct an activity to teach Tempo.</p>
        ) : (
          <>
            <ul className="mt-3 overflow-hidden rounded-md border bg-background" aria-label="Learned correction patterns">
              {learned.map((pattern) => (
                <li key={pattern.id} className="flex min-h-11 items-center gap-2 border-b px-2.5 last:border-b-0">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${pattern.state === 'focused' ? 'bg-emerald-500' : 'bg-rose-500'}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1 py-1.5">
                    <p className="truncate text-xs font-medium">{pattern.toolLabel} · {pattern.state === 'focused' ? 'Work' : 'Distraction'}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {pattern.goalCues.join(' · ') || 'Similar goals'} · {pattern.exampleCount} explicit {pattern.exampleCount === 1 ? 'correction' : 'corrections'}{pattern.conflicted ? ' · Conflicted' : ''}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    title="Forget this pattern"
                    aria-label={`Forget learned pattern for ${pattern.toolLabel}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => remove.mutate({ token, id: pattern.id })}
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
                  if (window.confirm('Clear all learned classification patterns? Exact remembered corrections will remain.')) {
                    clear.mutate({ token })
                  }
                }}
              >
                Clear learned patterns
              </Button>
            </div>
          </>
        ))}
      </div>
    </section>
  )
}
