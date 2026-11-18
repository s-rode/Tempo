import { useMemo } from 'react'
import type { ActivitySessionBlock } from '../lib/activitySessions'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import type { DayOverview } from '../lib/dayOverview'
import { cn } from '../lib/utils'

interface DayHeroProps {
  overview: DayOverview
  /** Shows the whole day as one bar under the totals. */
  showStrip?: boolean
  selectedSessionId?: string | null
  selectedActivityKey?: string | null
  onSelectSession?: (session: ActivitySessionBlock) => void
  /** Current time when the shown day is today, used for the "now" marker. */
  nowMs?: number | null
}

const HOUR_MS = 3_600_000

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

const RING_RADIUS = 19
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

/** The day's totals at a glance, shared by the timeline and the hour grid. */
export default function DayHero({
  overview,
  showStrip = false,
  selectedSessionId,
  selectedActivityKey,
  onSelectSession,
  nowMs
}: DayHeroProps) {
  const trackedMs = overview.focusedMs + overview.distractedMs + overview.uncertainMs
  const focusShare = trackedMs > 0 ? overview.focusedMs / trackedMs : 0
  const span = overview.endMs - overview.startMs
  const firstMs = overview.rows[0]?.segments[0]?.startMs ?? overview.startMs
  const lastMs = useMemo(
    () =>
      overview.rows.reduce(
        (latest, row) => row.segments.reduce((value, item) => Math.max(value, item.endMs), latest),
        overview.startMs
      ),
    [overview]
  )
  // Label every hour while they fit, then every second or third one.
  const hourStep = overview.rows.length <= 11 ? 1 : overview.rows.length <= 18 ? 2 : 3
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
  const nowOffset =
    nowMs && nowMs > overview.startMs && nowMs < overview.endMs
      ? (nowMs - overview.startMs) / span
      : null

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
      {showStrip && (
        <div className={cn('tempo-daystrip', selectedSessionId && 'has-selection')}>
          <div className="tempo-daystrip-track">
            {overview.rows.slice(1).map((row) => (
              <span
                key={row.hourStartMs}
                className="tempo-daystrip-tick"
                style={{ left: `${((row.hourStartMs - overview.startMs) / span) * 100}%` }}
                aria-hidden="true"
              />
            ))}
            {overview.rows.flatMap((row) =>
              row.segments.map((segment) => (
                <button
                  key={`${segment.session.id}:${segment.startMs}`}
                  type="button"
                  tabIndex={-1}
                  className={cn(
                    'tempo-daystrip-segment',
                    `is-${segment.state}`,
                    selectedSessionId === segment.session.id && 'is-selected',
                    selectedActivityKey === segment.session.displayKey && 'is-related'
                  )}
                  style={{
                    left: `${((segment.startMs - overview.startMs) / span) * 100}%`,
                    width: `${((segment.endMs - segment.startMs) / span) * 100}%`
                  }}
                  title={`${segment.session.label} · ${clock(+segment.session.startTime)}–${clock(+segment.session.endTime)}`}
                  aria-label={`${segment.session.label}, ${clock(segment.startMs)} to ${clock(segment.endMs)}, ${segment.state}`}
                  onClick={() => onSelectSession?.(segment.session)}
                />
              ))
            )}
            {nowOffset !== null && (
              <span
                className="tempo-day-now"
                style={{ left: `${nowOffset * 100}%` }}
                aria-hidden="true"
              />
            )}
          </div>
          <div className="tempo-daystrip-hours" aria-hidden="true">
            {overview.rows.map((row, index) =>
              index % hourStep === 0 ? (
                <span
                  key={row.hourStartMs}
                  style={{ left: `${((row.hourStartMs - overview.startMs) / span) * 100}%` }}
                >
                  {clock(row.hourStartMs)}
                </span>
              ) : null
            )}
            {overview.endMs - overview.rows[overview.rows.length - 1].hourStartMs >= HOUR_MS && (
              <span className="is-end" style={{ left: '100%' }}>
                {clock(overview.endMs)}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
