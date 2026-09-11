import { Activity, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../utils/trpc'

const percent = (value: number | null | undefined) =>
  value == null ? '—' : `${Math.round(value * 100)}%`

export function ClassificationHealthSettings() {
  const { token } = useAuth()
  const [expanded, setExpanded] = useState(false)
  const health = trpc.activeWindowEvents.getClassificationHealth.useQuery(
    { token: token || '' },
    { enabled: Boolean(token && expanded), staleTime: 30_000 }
  )

  return (
    <section className="tempo-settings-row items-start">
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Classification health
        </h2>
        <p>Private, aggregate diagnostics from the last seven days.</p>
        {expanded && (
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm" role="status">
            {health.isLoading ? (
              <span className="col-span-2 text-muted-foreground">Loading local diagnostics…</span>
            ) : health.data ? (
              <>
                <span className="text-muted-foreground">Successful decisions</span>
                <span className="text-right tabular-nums">{percent(health.data.successRate)}</span>
                <span className="text-muted-foreground">Median / p95 latency</span>
                <span className="text-right tabular-nums">
                  {health.data.medianLatencyMs == null
                    ? '—'
                    : `${(health.data.medianLatencyMs / 1000).toFixed(1)}s`}
                  {' / '}
                  {health.data.p95LatencyMs == null
                    ? '—'
                    : `${(health.data.p95LatencyMs / 1000).toFixed(1)}s`}
                </span>
                <span className="text-muted-foreground">Cache reuse</span>
                <span className="text-right tabular-nums">{percent(health.data.cacheHitRate)}</span>
                <span className="text-muted-foreground">DOM / OCR / title inputs</span>
                <span className="text-right tabular-nums">
                  {health.data.sourceCounts.dom} / {health.data.sourceCounts.ocr} /{' '}
                  {health.data.sourceCounts.title}
                </span>
                <span className="text-muted-foreground">Technical failures / corrections</span>
                <span className="text-right tabular-nums">
                  {health.data.technicalFailures} / {health.data.corrections}
                </span>
              </>
            ) : (
              <span className="col-span-2 text-muted-foreground">Diagnostics are unavailable.</span>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? 'Hide' : 'Details'}
        <ChevronRight
          className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
      </button>
    </section>
  )
}
