import { useMemo } from 'react'
import { buildWeekColumns, weekDurationLabel } from '../lib/weekColumns'
import { cn } from '../lib/utils'
import type { ProcessedEventBlock } from './DashboardView'

interface WeekViewProps {
  processedEvents: ProcessedEventBlock[] | null
  selectedDate: Date
  selectedDay: Date | null
  onDaySelect: (day: Date | null) => void
}

const HOUR_MS = 3_600_000

/** One column per day, Sunday first: focused and distracted time side by side. */
export default function WeekView(props: WeekViewProps) {
  const columns = useMemo(
    () => buildWeekColumns(props.processedEvents || [], props.selectedDate),
    [props.processedEvents, props.selectedDate]
  )
  // The busiest day sets the scale, rounded up to a whole two hours.
  const scaleMs = Math.max(
    4 * HOUR_MS,
    Math.ceil(
      Math.max(...columns.map((column) => Math.max(column.focusedMs, column.distractedMs))) /
        (2 * HOUR_MS)
    ) *
      2 *
      HOUR_MS
  )
  const height = (duration: number) => `${Math.max(2, (duration / scaleMs) * 100)}%`
  const todayKey = new Date().toDateString()
  return (
    <div className="tempo-week">
      <div className="tempo-glass-card tempo-week-card">
        <div className="tempo-week-legend">
          <span>
            <span className="tempo-day-dot is-focused" aria-hidden="true" />
            Focused
          </span>
          <span>
            <span className="tempo-day-dot is-distracted" aria-hidden="true" />
            Distracted
          </span>
          <span className="ml-auto tabular-nums">Scale {scaleMs / HOUR_MS}h</span>
        </div>
        <div className="tempo-week-grid">
          {columns.map((column) => {
            const selected = props.selectedDay?.toDateString() === column.date.toDateString()
            const today = column.date.toDateString() === todayKey
            const total = column.focusedMs + column.distractedMs
            return (
              <button
                key={column.date.getTime()}
                type="button"
                aria-pressed={selected}
                aria-label={`${column.date.toLocaleDateString()}: ${
                  total > 0
                    ? `${weekDurationLabel(column.focusedMs) || '0m'} focused, ${weekDurationLabel(column.distractedMs) || '0m'} distracted`
                    : 'No activity'
                }`}
                onClick={() => props.onDaySelect(selected ? null : column.date)}
                className={cn('tempo-week-day', selected && 'is-selected', today && 'is-today')}
              >
                <span className="tempo-week-day-name">
                  {column.date.toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
                <span className="tempo-week-day-date">{column.date.getDate()}</span>
                <span className="tempo-week-bars" aria-hidden="true">
                  {column.focusedMs > 0 && (
                    <span className="is-focused" style={{ height: height(column.focusedMs) }} />
                  )}
                  {column.distractedMs > 0 && (
                    <span
                      className="is-distracted"
                      style={{ height: height(column.distractedMs) }}
                    />
                  )}
                </span>
                <span className="tempo-week-total">
                  <strong>{weekDurationLabel(column.focusedMs) || '–'}</strong>
                  {column.distractedMs >= 60_000 && (
                    <span>{weekDurationLabel(column.distractedMs)} off</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
