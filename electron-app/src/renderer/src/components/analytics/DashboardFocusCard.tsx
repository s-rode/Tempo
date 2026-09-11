import { TrendingDown, TrendingUp } from 'lucide-react'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { formatDuration } from '../../lib/activityByCategoryWidgetHelpers'
import { trpc } from '../../utils/trpc'
import { type DurationPoint } from './AnalyticsCharts'
import { Card, CardContent } from '../ui/card'

type WeeklyFocusPoint = DurationPoint & {
  dayStartMs: number
  isFuture: boolean
}

type FocusComparisonMode = 'all_active_days' | 'same_day_type' | 'same_weekday'

const hourMs = 60 * 60 * 1000
const minuteMs = 60 * 1000

const startOfWeek = (value: Date) => {
  const date = new Date(value)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  date.setHours(0, 0, 0, 0)
  return date
}

const dayTimeLabel = (value: Date) =>
  value.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

const chartDuration = (value: number) => {
  if (value === 0) return '0'
  if (value < hourMs) return `${Math.round(value / minuteMs)}m`
  return `${Math.round((value / hourMs) * 10) / 10}h`
}

const dayLabel = (value: number, isToday: boolean) =>
  isToday ? 'Today' : new Date(value).toLocaleDateString(undefined, { weekday: 'long' })

const comparisonCopy = (mode: FocusComparisonMode, date: Date) => {
  if (mode === 'same_weekday') {
    return `average ${date.toLocaleDateString(undefined, { weekday: 'long' })}`
  }
  if (mode === 'same_day_type') {
    return date.getDay() === 0 || date.getDay() === 6 ? 'average weekend day' : 'average weekday'
  }
  return 'average active day'
}

const roundedScaleMaximum = (value: number) => {
  const target = Math.max(hourMs, value * 1.12)
  return (
    [
      hourMs,
      2 * hourMs,
      3 * hourMs,
      4 * hourMs,
      6 * hourMs,
      8 * hourMs,
      10 * hourMs,
      12 * hourMs
    ].find((candidate) => candidate >= target) || Math.ceil(target / (2 * hourMs)) * 2 * hourMs
  )
}

function WeekFocusBars({
  points,
  currentIndex
}: {
  points: WeeklyFocusPoint[]
  currentIndex?: number
}) {
  const selectableIndexes = useMemo(
    () => points.flatMap((point, index) => (point.isFuture ? [] : [index])),
    [points]
  )
  const fallbackIndex = selectableIndexes.at(-1) ?? 0
  const initialIndex =
    currentIndex !== undefined && !points[currentIndex]?.isFuture ? currentIndex : fallbackIndex
  const [selectedIndex, setSelectedIndex] = useState(initialIndex)
  const dayButtonRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => setSelectedIndex(initialIndex), [initialIndex])

  const maximum = roundedScaleMaximum(
    Math.max(0, ...points.filter((point) => !point.isFuture).map((point) => point.focusedMs))
  )
  const selected = points[selectedIndex] || points[fallbackIndex]
  const selectedIsToday = selectedIndex === currentIndex
  const weekTotal = points
    .filter((point) => !point.isFuture)
    .reduce((total, point) => total + point.focusedMs, 0)
  const best = points
    .filter((point) => !point.isFuture)
    .reduce<WeeklyFocusPoint | null>(
      (current, point) => (!current || point.focusedMs > current.focusedMs ? point : current),
      null
    )

  const selectDay = (index: number, moveFocus = false) => {
    if (points[index]?.isFuture) return
    setSelectedIndex(index)
    if (moveFocus) requestAnimationFrame(() => dayButtonRefs.current[index]?.focus())
  }

  const moveSelection = (direction: -1 | 1) => {
    const current = Math.max(0, selectableIndexes.indexOf(selectedIndex))
    const next =
      selectableIndexes[Math.min(selectableIndexes.length - 1, Math.max(0, current + direction))] ??
      fallbackIndex
    selectDay(next, true)
  }

  const handleDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      moveSelection(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      moveSelection(1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      selectDay(selectableIndexes[0] ?? fallbackIndex, true)
    } else if (event.key === 'End') {
      event.preventDefault()
      selectDay(selectableIndexes.at(-1) ?? fallbackIndex, true)
    }
  }

  if (!points.length) return null

  return (
    <section className="tempo-week-focus-chart" aria-label="Focused time this week">
      <div className="tempo-week-focus-chart-heading">
        <span>This week</span>
        <span>{formatDuration(weekTotal)} total</span>
      </div>
      <div className="tempo-week-focus-plot">
        <div className="tempo-week-focus-axis" aria-hidden="true">
          <span>{chartDuration(maximum)}</span>
          <span>{chartDuration(maximum / 2)}</span>
          <span>0</span>
        </div>
        <div
          className="tempo-week-focus-bars"
          role="group"
          aria-label="Select a weekday to inspect"
        >
          <span className="tempo-week-focus-gridline is-top" aria-hidden="true" />
          <span className="tempo-week-focus-gridline is-middle" aria-hidden="true" />
          <span className="tempo-week-focus-gridline is-bottom" aria-hidden="true" />
          {points.map((point, index) => {
            const selectedDay = index === selectedIndex
            const today = index === currentIndex
            const height =
              point.focusedMs === 0 ? 0 : Math.max(4, (point.focusedMs / maximum) * 100)
            return (
              <button
                key={point.dayStartMs}
                ref={(element) => {
                  dayButtonRefs.current[index] = element
                }}
                type="button"
                disabled={point.isFuture}
                aria-pressed={selectedDay}
                aria-label={
                  point.isFuture
                    ? `${point.label}, upcoming`
                    : `${dayLabel(point.dayStartMs, today)}: ${formatDuration(point.focusedMs)} focused. Select to inspect.`
                }
                onClick={() => selectDay(index)}
                onMouseEnter={() => selectDay(index)}
                onFocus={() => selectDay(index)}
                onKeyDown={handleDayKeyDown}
                className={`tempo-week-focus-day ${selectedDay ? 'is-selected' : ''} ${today ? 'is-today' : ''} ${point.isFuture ? 'is-future' : ''}`}
              >
                <span className="tempo-week-focus-bar-slot">
                  <span className="tempo-week-focus-bar" style={{ height: `${height}%` }} />
                </span>
                <span className="tempo-week-focus-day-label">{point.label}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="tempo-week-focus-selection" aria-live="polite">
        <div>
          <span>{selected ? dayLabel(selected.dayStartMs, selectedIsToday) : '—'}</span>
          <strong>{selected ? formatDuration(selected.focusedMs) : '—'} focused</strong>
        </div>
        {best && best.focusedMs > 0 && (
          <span>
            Best: {new Date(best.dayStartMs).toLocaleDateString(undefined, { weekday: 'short' })}{' '}
            {formatDuration(best.focusedMs)}
          </span>
        )}
      </div>
    </section>
  )
}

export function DashboardFocusCard() {
  const { token } = useAuth()
  const { data: settings } = trpc.user.getElectronAppSettings.useQuery(
    { token: token || '' },
    { enabled: !!token }
  )
  const comparisonMode = (settings?.focusComparisonMode || 'all_active_days') as FocusComparisonMode
  const [comparisonAtMs, setComparisonAtMs] = useState(() => Date.now())
  useEffect(() => {
    // The comparison is rendered to the minute. Align the one local refresh
    // to that boundary instead of keeping an arbitrary thirty-second poll.
    let timer: number | undefined
    const scheduleNextMinute = () => {
      const delay = 60_000 - (Date.now() % 60_000) + 25
      timer = window.setTimeout(() => {
        setComparisonAtMs(Date.now())
        scheduleNextMinute()
      }, delay)
    }
    scheduleNextMinute()
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])

  const now = useMemo(() => new Date(comparisonAtMs), [comparisonAtMs])
  const weekStart = startOfWeek(now)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const { data, isLoading } = trpc.analytics.getPeriod.useQuery(
    {
      token: token || '',
      startDateMs: weekStart.getTime(),
      endDateMs: weekEnd.getTime(),
      comparisonAtMs,
      focusComparisonMode: comparisonMode
    },
    { enabled: !!token, refetchOnWindowFocus: true }
  )
  const weekDays = useMemo(
    () =>
      (data?.days || []).filter(
        (day: any) => day.startDateMs >= weekStart.getTime() && day.startDateMs < weekEnd.getTime()
      ),
    [data, weekStart, weekEnd]
  )
  const points = useMemo<WeeklyFocusPoint[]>(
    () =>
      weekDays.map((day: any) => ({
        label: new Date(day.startDateMs).toLocaleDateString(undefined, { weekday: 'short' }),
        focusedMs: day.focusedMs,
        distractedMs: day.distractedMs,
        uncertainMs: day.uncertainMs,
        dayStartMs: day.startDateMs,
        isFuture: day.startDateMs > todayStart.getTime()
      })),
    [weekDays, todayStart]
  )
  const today = weekDays.find((day: any) => day.startDateMs === todayStart.getTime())
  const averageDayByNow = data?.averageDayByNow
  const usualMs = averageDayByNow?.focusedMs ?? null
  const sampleCount = averageDayByNow?.sampleCount ?? 0
  const todayFocusedMs = today?.focusedMs || 0
  const delta = usualMs === null ? null : todayFocusedMs - usualMs
  const currentIndex = points.findIndex((point) => point.dayStartMs === todayStart.getTime())

  return (
    <Card className="mb-3 overflow-hidden border-border bg-card">
      <CardContent className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">
            Focus this week
          </p>
          <span className="text-[11px] text-muted-foreground">Updated {dayTimeLabel(now)}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 divide-x divide-border">
          <div className="pr-3">
            <p className="text-[11px] text-muted-foreground">Today through {dayTimeLabel(now)}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
              {isLoading ? '—' : formatDuration(todayFocusedMs)}
            </p>
            <p className="text-xs text-muted-foreground">focused</p>
          </div>
          <div className="pl-3">
            <p className="text-[11px] text-muted-foreground">Normal pace by now</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
              {isLoading ? '—' : usualMs === null ? '—' : formatDuration(usualMs)}
            </p>
            <p className="text-xs text-muted-foreground">{comparisonCopy(comparisonMode, now)}</p>
          </div>
        </div>
        {delta !== null ? (
          <div
            className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground"
            aria-live="polite"
          >
            {delta >= 0 ? (
              <TrendingUp size={14} className="mt-0.5 shrink-0 text-emerald-500" />
            ) : (
              <TrendingDown size={14} className="mt-0.5 shrink-0 text-rose-500" />
            )}
            <span>
              {Math.abs(delta) < 60_000
                ? `On pace with your normal day by ${dayTimeLabel(now)}.`
                : `${formatDuration(Math.abs(delta))} ${delta >= 0 ? 'ahead of' : 'behind'} your normal pace by ${dayTimeLabel(now)}.`}
            </span>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            No comparable tracked days yet. Tempo will show a normal pace after it has history for
            this setting ({sampleCount}/4).
          </p>
        )}
        <WeekFocusBars
          points={points}
          currentIndex={currentIndex >= 0 ? currentIndex : undefined}
        />
      </CardContent>
    </Card>
  )
}
