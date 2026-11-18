import { useMemo } from 'react'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import type { DayOverview } from '../lib/dayOverview'
import { cn } from '../lib/utils'

interface DayHeroProps {
  overview: DayOverview
}

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

const RING_RADIUS = 19
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

/** The day's totals at a glance, above the hour grid. */
export default function DayHero({ overview }: DayHeroProps) {
  const trackedMs = overview.focusedMs + overview.distractedMs + overview.uncertainMs
  const focusShare = trackedMs > 0 ? overview.focusedMs / trackedMs : 0
  const firstMs = overview.rows[0]?.segments[0]?.startMs ?? overview.startMs
  const lastMs = useMemo(
    () =>
      overview.rows.reduce(
        (latest, row) => row.segments.reduce((value, item) => Math.max(value, item.endMs), latest),
        overview.startMs
      ),
    [overview]
  )
  const stats = [
    { state: 'is-distracted', label: 'Distracted', durationMs: overview.distractedMs, show: true },
    {
      state: 'is-uncertain',
      label: 'Uncertain',
      durationMs: overview.uncertainMs,
      show: overview.uncertainMs > 0
    },
    { state: 'is-idle', label: 'Idle', durationMs: overview.idleMs, show: true }
  ].filter((item) => item.show)
  return (
    <section className="tempo-glass-card tempo-dayhero" aria-label="Day summary">
      <div className="tempo-dayhero-top">
        <div className="tempo-dayhero-primary">
          <p className="tempo-dayhero-eyebrow">Focused</p>
          <p className="tempo-dayhero-value">{formatDuration(overview.focusedMs)}</p>
          <p className="tempo-dayhero-sub">
            of {formatDuration(trackedMs)} tracked · {clock(firstMs)}–{clock(lastMs)}
          </p>
        </div>
        <dl className="tempo-dayhero-stats">
          {stats.map((item) => (
            <div key={item.state}>
              <dt>
                <span className={cn('tempo-day-dot', item.state)} aria-hidden="true" />
                {item.label}
              </dt>
              <dd>{formatDuration(item.durationMs)}</dd>
            </div>
          ))}
        </dl>
        <div
          className="tempo-dayhero-ring"
          role="img"
          aria-label={`${Math.round(focusShare * 100)} percent of tracked time focused`}
        >
          <svg viewBox="0 0 46 46" width="46" height="46" aria-hidden="true">
            <circle cx="23" cy="23" r={RING_RADIUS} className="tempo-dayhero-ring-track" />
            <circle
              cx="23"
              cy="23"
              r={RING_RADIUS}
              className="tempo-dayhero-ring-value"
              strokeDasharray={`${focusShare * RING_LENGTH} ${RING_LENGTH}`}
              transform="rotate(-90 23 23)"
            />
          </svg>
          <span>
            {Math.round(focusShare * 100)}
            <small>%</small>
          </span>
        </div>
      </div>
    </section>
  )
}
