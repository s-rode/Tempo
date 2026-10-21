import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { trpc } from '../utils/trpc'
import { Button } from './ui/button'

function SessionReview({
  runId,
  goal,
  onChange
}: {
  runId: string
  goal: string
  onChange: () => void
}) {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const samples = trpc.activeWindowEvents.getClassificationReviewSamples.useMutation()
  const [open, setOpen] = useState(false)
  const [labels, setLabels] = useState<Record<string, string>>({})
  const submit = trpc.activeWindowEvents.submitClassificationReview.useMutation({
    onSuccess: (_result, input) => {
      setLabels((previous) => ({ ...previous, [input.sampleId]: input.label }))
      void utils.activeWindowEvents.getLatestEvent.invalidate()
      void utils.activeWindowEvents.getScopedPreferences.invalidate()
      void window.api?.refreshCurrentActivity()
      onChange()
    }
  })
  return (
    <details
      onToggle={(event) => {
        const expanded = event.currentTarget.open
        setOpen(expanded)
        if (expanded && !samples.data && !samples.isLoading && token)
          samples.mutate({ token, runId })
      }}
    >
      <summary className="cursor-pointer py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {goal}
      </summary>
      {open && (
        <div className="space-y-3 pb-2">
          <p className="text-xs text-muted-foreground">
            Were these activities related to this session’s task? Skipping changes nothing.
          </p>
          {samples.isLoading && (
            <p className="text-xs" role="status">
              Loading activities…
            </p>
          )}
          {samples.error && (
            <p className="text-xs" role="alert">
              Could not load this review. Close and reopen it to retry.
            </p>
          )}
          {samples.data?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No automatic productive decisions to review.
            </p>
          )}
          {samples.data?.map((sample) => {
            const label = labels[sample.id] || sample.label
            return (
              <div key={sample.id} className="rounded-md border p-2.5">
                <p className="text-xs font-medium break-words">
                  {sample.ownerName} · {sample.title || sample.ownerName}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {sample.startedAtMs
                    ? new Date(sample.startedAtMs).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                    : ''}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground break-words">
                  Task: {sample.goal}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {sample.stratum === 'random'
                    ? 'Random productive activity'
                    : 'A decision based on learned context or tool capabilities'}
                </p>
                <div
                  className="mt-2 flex flex-wrap gap-1"
                  role="group"
                  aria-label={`Review ${sample.ownerName}`}
                >
                  {(['focused', 'distracted', 'unsure'] as const).map((value) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={label === value ? 'secondary' : 'outline'}
                      aria-pressed={label === value}
                      disabled={submit.isLoading}
                      onClick={() =>
                        token &&
                        submit.mutate({
                          token,
                          sampleId: sample.id,
                          label: value,
                          requestId: crypto.randomUUID()
                        })
                      }
                    >
                      {value === 'focused'
                        ? 'Related'
                        : value === 'distracted'
                          ? 'Off task'
                          : 'Unsure'}
                    </Button>
                  ))}
                </div>
              </div>
            )
          })}
          {submit.error && (
            <p className="text-xs" role="alert">
              Could not save your review. Please try again.
            </p>
          )}
        </div>
      )}
    </details>
  )
}

export function ClassificationReview({
  startDateMs,
  endDateMs,
  onChange
}: {
  startDateMs: number
  endDateMs: number
  onChange: () => void
}) {
  const { token } = useAuth()
  const [open, setOpen] = useState(false)
  const sessions = trpc.activeWindowEvents.getClassificationReviewSessions.useQuery(
    { token: token || '', startDateMs, endDateMs },
    { enabled: Boolean(open && token), staleTime: 30_000 }
  )
  return (
    <details className="border-b py-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Review classifications
      </summary>
      {open && (
        <div className="mt-2">
          <p className="text-xs text-muted-foreground">
            Optional checks help find distractions Tempo missed.
          </p>
          {sessions.data?.map((session) => (
            <SessionReview
              key={session.runId}
              runId={session.runId}
              goal={session.goal}
              onChange={onChange}
            />
          ))}
          {sessions.data?.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Reviews appear after a focus session ends.
            </p>
          )}
        </div>
      )}
    </details>
  )
}
