import { TrendingDown, TrendingUp } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { formatDuration } from '../../lib/activityByCategoryWidgetHelpers'
import { trpc } from '../../utils/trpc'
import { FOCUSED, type DurationPoint } from './AnalyticsCharts'
import { Card, CardContent } from '../ui/card'

type WeeklyFocusPoint = DurationPoint & {
  dayStartMs: number
  isFuture: boolean
}

const startOfWeek = (value: Date) => {
  const date = new Date(value)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  date.setHours(0, 0, 0, 0)
  return date
}

const dayTimeLabel = (value: Date) => value.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

function WeekFocusTrend({ points, currentIndex }: { points: WeeklyFocusPoint[]; currentIndex?: number }) {
  const gradientId = useId().replace(/:/g, '')
  const selectableIndexes = useMemo(() => points.flatMap((point, index) => point.isFuture ? [] : [index]), [points])
  const fallbackIndex = selectableIndexes.at(-1) ?? 0
  const initialIndex = currentIndex !== undefined && !points[currentIndex]?.isFuture ? currentIndex : fallbackIndex
  const [selectedIndex, setSelectedIndex] = useState(initialIndex)
  const dayButtonRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => setSelectedIndex(initialIndex), [initialIndex])

  const max = Math.max(60 * 60 * 1000, ...points.filter((point) => !point.isFuture).map((point) => point.focusedMs))
  const coordinates = points.map((point, index) => ({
    x: points.length === 1 ? 50 : 8 + (index / Math.max(1, points.length - 1)) * 84,
    y: 75 - (point.focusedMs / max) * 47
  }))
  const plotted = coordinates.filter((_, index) => !points[index].isFuture)
  const line = plotted.map((point) => `${point.x},${point.y}`).join(' ')
  const area = plotted.length ? `${plotted[0].x},78 ${line} ${plotted.at(-1)!.x},78` : ''
  const selected = points[selectedIndex] || points[fallbackIndex]
  const selectedCoordinate = coordinates[selectedIndex] || coordinates[fallbackIndex]

  const selectDay = (index: number, moveFocus = false) => {
    if (points[index]?.isFuture) return
    setSelectedIndex(index)
    if (moveFocus) requestAnimationFrame(() => dayButtonRefs.current[index]?.focus())
  }

  const moveSelection = (direction: -1 | 1) => {
    const current = Math.max(0, selectableIndexes.indexOf(selectedIndex))
    const next = selectableIndexes[Math.min(selectableIndexes.length - 1, Math.max(0, current + direction))] ?? fallbackIndex
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

  return (
    <section className="mt-4 border-t border-border pt-3" aria-label="Focused time this week">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium text-foreground">This week</h3>
        <span className="text-[11px] text-muted-foreground">{selectedIndex === currentIndex ? 'Today' : selected?.label || '—'} · {selected ? formatDuration(selected.focusedMs) : '—'}</span>
      </div>
      <div className="relative h-28">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible" role="img" aria-label="Weekly focused time trend">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop stopColor={FOCUSED} stopOpacity=".16" />
              <stop offset="1" stopColor={FOCUSED} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[31, 55, 78].map((y) => <line key={y} x1="8" x2="92" y1={y} y2={y} stroke="currentColor" className="text-border" strokeWidth=".45" />)}
          {area && <polygon points={area} fill={`url(#${gradientId})`} />}
          {line && <polyline points={line} fill="none" stroke={FOCUSED} strokeWidth="1.35" vectorEffect="non-scaling-stroke" />}
          {selectedCoordinate && <line x1={selectedCoordinate.x} x2={selectedCoordinate.x} y1="17" y2="79" stroke="currentColor" className="text-border" strokeWidth=".55" />}
          {coordinates.map((coordinate, index) => {
            const point = points[index]
            const isCurrent = index === currentIndex
            const isSelected = index === selectedIndex
            return (
              <g key={point.dayStartMs} aria-hidden="true" onClick={() => selectDay(index)} onMouseEnter={() => selectDay(index)} className={point.isFuture ? 'opacity-25' : 'cursor-pointer'}>
                <circle cx={coordinate.x} cy={coordinate.y} r="5" fill="transparent" />
                {isCurrent && <circle cx={coordinate.x} cy={coordinate.y} r="3.1" fill="none" stroke={FOCUSED} strokeOpacity=".28" strokeWidth=".8" vectorEffect="non-scaling-stroke" />}
                <circle cx={coordinate.x} cy={coordinate.y} r={isSelected ? '2.1' : '1.35'} fill={FOCUSED} vectorEffect="non-scaling-stroke" />
              </g>
            )
          })}
        </svg>
        <div className="absolute inset-x-[8%] bottom-0 flex justify-between" role="group" aria-label="Select a weekday to inspect">
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
              className={`-mx-1 rounded-sm px-1 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${index === selectedIndex ? 'font-medium text-foreground' : point.isFuture ? 'cursor-default opacity-40' : ''}`}
            >
              {point.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Select a day to inspect it. Arrow keys move between tracked days.</p>
    </section>
  )
}

export function DashboardFocusCard() {
  const { token } = useAuth()
  const [comparisonAtMs, setComparisonAtMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setComparisonAtMs(Date.now()), 30_000)
    return () => window.clearInterval(timer)
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
      comparisonAtMs
    },
    { enabled: !!token, refetchInterval: 30_000 }
  )
  const weekDays = useMemo(
    () => (data?.days || []).filter((day: any) => day.startDateMs >= weekStart.getTime() && day.startDateMs < weekEnd.getTime()),
    [data, weekStart, weekEnd]
  )
  const points = useMemo<WeeklyFocusPoint[]>(
    () => weekDays.map((day: any) => ({
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
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">Focus this week</p>
        <div className="mt-3 grid grid-cols-2 divide-x divide-border">
          <div className="pr-3">
            <p className="text-[11px] text-muted-foreground">Today · by {dayTimeLabel(now)}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{isLoading ? '—' : formatDuration(todayFocusedMs)}</p>
            <p className="text-xs text-muted-foreground">focused</p>
          </div>
          <div className="pl-3">
            <p className="text-[11px] text-muted-foreground">Usual by now</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{isLoading ? '—' : usualMs === null ? '—' : formatDuration(usualMs)}</p>
            <p className="text-xs text-muted-foreground">average active day</p>
          </div>
        </div>
        {delta !== null ? (
          <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground" aria-live="polite">
            {delta >= 0 ? <TrendingUp size={14} className="mt-0.5 shrink-0 text-emerald-500" /> : <TrendingDown size={14} className="mt-0.5 shrink-0 text-rose-500" />}
            <span>{Math.abs(delta) < 60_000 ? `On pace with your average by ${dayTimeLabel(now)}.` : `${formatDuration(Math.abs(delta))} ${delta >= 0 ? 'ahead of' : 'behind'} your average by ${dayTimeLabel(now)}.`}</span>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">Need more tracked days before Tempo can show your average pace ({sampleCount}/4).</p>
        )}
        <WeekFocusTrend points={points} currentIndex={currentIndex >= 0 ? currentIndex : undefined} />
        {sampleCount > 0 && <p className="mt-3 text-[11px] text-muted-foreground">Average pace uses the previous {sampleCount} active day{sampleCount === 1 ? '' : 's'}, each clipped at {dayTimeLabel(now)}.</p>}
      </CardContent>
    </Card>
  )
}
