import { TrendingDown, TrendingUp } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { formatDuration } from '../../lib/activityByCategoryWidgetHelpers'
import { trpc } from '../../utils/trpc'
import { type DurationPoint, FOCUSED } from './AnalyticsCharts'
import { Card, CardContent } from '../ui/card'

type WeeklyFocusPoint = DurationPoint & {
  dayStartMs: number
  isFuture: boolean
}

const startOfWeek = (value: Date) => {
  const date = new Date(value)
  const day = date.getDay()
  date.setDate(date.getDate() - ((day + 6) % 7))
  date.setHours(0, 0, 0, 0)
  return date
}

const ratio = (value: number, total: number) => total > 0 ? Math.round((value / total) * 100) : null

function WeekFocusChart({
  points,
  currentIndex,
  averageMs
}: {
  points: WeeklyFocusPoint[]
  currentIndex?: number
  averageMs?: number | null
}) {
  const gradientId = useId().replace(/:/g, '')
  const usableIndexes = useMemo(() => points.flatMap((point, index) => point.isFuture ? [] : [index]), [points])
  const fallbackIndex = usableIndexes.at(-1) ?? 0
  const initialIndex = currentIndex !== undefined && !points[currentIndex]?.isFuture ? currentIndex : fallbackIndex
  const [selectedIndex, setSelectedIndex] = useState(initialIndex)
  const dayButtonRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    setSelectedIndex(initialIndex)
  }, [initialIndex])

  const max = Math.max(
    60 * 60 * 1000,
    averageMs || 0,
    ...points.filter((point) => !point.isFuture).map((point) => point.focusedMs)
  )
  const coordinates = points.map((point, index) => ({
    x: points.length === 1 ? 50 : 8 + (index / Math.max(1, points.length - 1)) * 84,
    y: 77 - (point.focusedMs / max) * 51
  }))
  const plotted = coordinates.filter((_, index) => !points[index].isFuture)
  const line = plotted.map((point) => `${point.x},${point.y}`).join(' ')
  const area = plotted.length ? `${plotted[0].x},80 ${line} ${plotted.at(-1)!.x},80` : ''
  const averageY = averageMs === null || averageMs === undefined ? null : 77 - (averageMs / max) * 51
  const selected = points[selectedIndex] || points[fallbackIndex]
  const selectedCoordinate = coordinates[selectedIndex] || coordinates[fallbackIndex]
  const trackedMs = selected ? selected.focusedMs + selected.distractedMs + selected.uncertainMs : 0
  const selectedRatio = selected ? ratio(selected.focusedMs, trackedMs) : null

  const selectDay = (index: number, moveFocus = false) => {
    if (points[index]?.isFuture) return
    setSelectedIndex(index)
    if (moveFocus) requestAnimationFrame(() => dayButtonRefs.current[index]?.focus())
  }

  const moveSelection = (direction: -1 | 1) => {
    const current = Math.max(0, usableIndexes.indexOf(selectedIndex))
    selectDay(usableIndexes[Math.min(usableIndexes.length - 1, Math.max(0, current + direction))] ?? fallbackIndex, true)
  }

  const handleDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      moveSelection(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      moveSelection(1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      selectDay(usableIndexes[0] ?? fallbackIndex, true)
    } else if (event.key === 'End') {
      event.preventDefault()
      selectDay(usableIndexes.at(-1) ?? fallbackIndex, true)
    }
  }

  return (
    <div className="mt-3" aria-label="Focused time this week">
      <div className="relative h-36 w-full">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible" role="img" aria-label="Select a day to inspect its focused time">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop stopColor={FOCUSED} stopOpacity=".20" />
              <stop offset="1" stopColor={FOCUSED} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[26, 52, 80].map((y) => <line key={y} x1="8" x2="92" y1={y} y2={y} stroke="currentColor" className="text-border" strokeWidth=".45" />)}
          {averageY !== null && <line x1="8" x2="92" y1={averageY} y2={averageY} stroke="currentColor" className="text-muted-foreground/75" strokeDasharray="1.5 1.5" strokeWidth=".65" />}
          {area && <polygon points={area} fill={`url(#${gradientId})`} />}
          {line && <polyline points={line} fill="none" stroke={FOCUSED} strokeWidth="1.45" vectorEffect="non-scaling-stroke" />}
          {selectedCoordinate && <line x1={selectedCoordinate.x} x2={selectedCoordinate.x} y1="13" y2="82" stroke="currentColor" className="text-muted-foreground/65" strokeWidth=".45" />}
          {coordinates.map((coordinate, index) => {
            const point = points[index]
            const isSelected = index === selectedIndex
            const isCurrent = index === currentIndex
            return (
              <g
                key={`${point.dayStartMs}-${point.label}`}
                aria-hidden="true"
                onClick={() => !point.isFuture && selectDay(index)}
                onMouseEnter={() => !point.isFuture && selectDay(index)}
                className={point.isFuture ? 'opacity-30' : 'cursor-pointer'}
              >
                <title>{point.isFuture ? `${point.label}: upcoming` : `${point.label}: ${formatDuration(point.focusedMs)} focused`}</title>
                <circle cx={coordinate.x} cy={coordinate.y} r="5.5" fill="transparent" />
                {isCurrent && <circle cx={coordinate.x} cy={coordinate.y} r="3.4" fill="none" stroke={FOCUSED} strokeOpacity=".28" strokeWidth=".8" vectorEffect="non-scaling-stroke" />}
                <circle cx={coordinate.x} cy={coordinate.y} r={isSelected ? '2.25' : '1.45'} fill={FOCUSED} vectorEffect="non-scaling-stroke" />
              </g>
            )
          })}
        </svg>
        <div className="absolute inset-x-[8%] bottom-0 flex justify-between text-[11px] text-muted-foreground" role="group" aria-label="Select a weekday to inspect">
          {points.map((point, index) => (
            <button
              key={point.dayStartMs}
              ref={(element) => { dayButtonRefs.current[index] = element }}
              type="button"
              disabled={point.isFuture}
              aria-pressed={index === selectedIndex}
              aria-label={point.isFuture ? `${point.label}, upcoming` : `${point.label}: ${formatDuration(point.focusedMs)} focused`}
              onClick={() => selectDay(index)}
              onFocus={() => selectDay(index)}
              onKeyDown={handleDayKeyDown}
              className={`-mx-1 rounded-sm px-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${index === selectedIndex ? 'font-medium text-foreground' : point.isFuture ? 'cursor-default opacity-45' : ''}`}
            >
              {point.label}
            </button>
          ))}
        </div>
        {averageMs !== null && averageMs !== undefined && <span className="absolute left-[8%] top-0 rounded bg-card/90 px-1 text-[10px] text-muted-foreground">Usual {formatDuration(averageMs)}</span>}
      </div>
      {selected && (
        <div className="mt-1 flex min-h-9 items-center justify-between gap-3 border-t border-border/70 pt-2 text-[11px]" aria-live="polite">
          <div className="min-w-0">
            <span className="font-medium text-foreground">{selectedIndex === currentIndex ? 'Today' : selected.label}</span>
            <span className="text-muted-foreground"> · {selected.isFuture ? 'Upcoming' : `${formatDuration(selected.focusedMs)} focused`}</span>
          </div>
          {!selected.isFuture && <span className="shrink-0 tabular-nums text-muted-foreground">{selectedRatio === null ? 'No tracked time' : `${selectedRatio}% focus`}</span>}
        </div>
      )}
    </div>
  )
}

export function DashboardFocusCard() {
  const { token } = useAuth()
  const now = new Date()
  const start = startOfWeek(now)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  // Keep this dashboard request lightweight and independent from the optional
  // historical baseline calculation. A delayed baseline must never leave the
  // current day's value blank.
  const historyStart = new Date(now)
  historyStart.setDate(historyStart.getDate() - 70)
  historyStart.setHours(0, 0, 0, 0)
  const { data, isLoading } = trpc.analytics.getPeriod.useQuery(
    { token: token || '', startDateMs: historyStart.getTime(), endDateMs: end.getTime() },
    { enabled: !!token, refetchInterval: 30_000 }
  )
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const currentWeekDays = useMemo(
    () => (data?.days || []).filter((day: any) => day.startDateMs >= start.getTime() && day.startDateMs < end.getTime()),
    [data, start, end]
  )
  const points = useMemo<WeeklyFocusPoint[]>(
    () => currentWeekDays.map((day: any) => ({
      label: new Date(day.startDateMs).toLocaleDateString(undefined, { weekday: 'short' }),
      focusedMs: day.focusedMs,
      distractedMs: day.distractedMs,
      uncertainMs: day.uncertainMs,
      dayStartMs: day.startDateMs,
      isFuture: day.startDateMs > todayStart.getTime()
    })),
    [currentWeekDays, todayStart]
  )
  const today = currentWeekDays.find((day: any) => new Date(day.startDateMs).toDateString() === now.toDateString())
  const usualSamples = useMemo(() => {
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    return (data?.days || []).filter((day: any) => {
      const date = new Date(day.startDateMs)
      return date < todayStart && date.getDay() === now.getDay() && (day.focusedMs + day.distractedMs + day.uncertainMs) > 0 && nowMinutes >= 0
    }).slice(-4)
  }, [data, now, todayStart])
  const usual = usualSamples.length ? Math.round(usualSamples.reduce((sum: number, day: any) => sum + day.focusedMs, 0) / usualSamples.length) : null
  const delta = today && usual !== null ? today.focusedMs - usual : null
  const currentIndex = points.findIndex((point) => point.dayStartMs === todayStart.getTime())

  return (
    <Card className="mb-3 overflow-hidden border-border bg-card">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">Focus this week</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight tabular-nums">{isLoading ? '—' : formatDuration(today?.focusedMs || 0)}</span>
              <span className="text-xs text-muted-foreground">focused today</span>
            </div>
          </div>
          {usual !== null ? (
            <div className="flex max-w-52 items-center gap-1 text-right text-xs text-muted-foreground">
              {delta !== null && delta >= 0 ? <TrendingUp size={14} className="shrink-0 text-emerald-500" /> : <TrendingDown size={14} className="shrink-0 text-rose-500" />}
              <span>{Math.abs(delta || 0) < 60_000 ? 'On pace with' : `${formatDuration(Math.abs(delta || 0))} ${delta && delta >= 0 ? 'ahead of' : 'behind'}`} your usual {now.toLocaleDateString(undefined, { weekday: 'long' })}</span>
            </div>
          ) : <span className="text-xs text-muted-foreground">Track a few matching weekdays to see your usual pace.</span>}
        </div>
        <WeekFocusChart points={points} currentIndex={currentIndex >= 0 ? currentIndex : undefined} averageMs={usual} />
        <p className="mt-2 text-[11px] text-muted-foreground">
          {usualSamples.length
            ? `Usual pace is based on ${usualSamples.length} earlier matching active weekday${usualSamples.length === 1 ? '' : 's'}.`
            : 'Select a day in the chart to inspect it. Calendar-day focus time · local only.'}
        </p>
      </CardContent>
    </Card>
  )
}
