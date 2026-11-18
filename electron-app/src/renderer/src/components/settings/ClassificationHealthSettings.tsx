import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../utils/trpc'
import { Button } from '../ui/button'
import { SettingsRow, SettingsSection } from './SettingsLayout'

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
    <SettingsSection title="Diagnostics">
      <SettingsRow
        title="Classification health"
        description="Private, aggregate diagnostics from the last seven days."
        control={
          <Button
            type="button"
            variant="glass"
            size="compact"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Hide' : 'Show'}
            <ChevronRight
              className={`transition-transform motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
          </Button>
        }
      >
        {expanded && (
          <div className="tempo-pref-stats" role="status">
            {health.isLoading ? (
              <span className="col-span-2 text-muted-foreground">Loading local diagnostics…</span>
            ) : health.data ? (
              <>
                <span className="text-muted-foreground">Without technical failure</span>
                <span className="text-right tabular-nums">
                  {percent(health.data.technicalSuccessRate)}
                </span>
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
                <span className="text-muted-foreground">Uncertain decisions</span>
                <span className="text-right tabular-nums">{health.data.semanticUncertainty}</span>
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
                <span className="text-muted-foreground">Marked Work / marked Distraction</span>
                <span className="text-right tabular-nums">
                  {health.data.positiveCorrections} / {health.data.negativeCorrections}
                </span>
                <p className="col-span-2 text-xs text-muted-foreground">
                  Correction counts and productive time do not measure accuracy. Productive reviews
                  below cover only explicitly labeled samples.
                </p>
                {health.data.productiveReviewsByStratum.map((review) => (
                  <p className="col-span-2 text-xs" key={review.stratum}>
                    {review.stratum === 'random'
                      ? 'Random samples'
                      : review.stratum === 'learned'
                        ? 'Learned-context samples'
                        : 'Tool-role samples'}
                    : {review.related} related · {review.offTask} off task · {review.unsure} unsure
                  </p>
                ))}
              </>
            ) : (
              <span className="col-span-2 text-muted-foreground">Diagnostics are unavailable.</span>
            )}
          </div>
        )}
      </SettingsRow>
    </SettingsSection>
  )
}
