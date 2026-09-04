import { useId, useMemo, useState } from 'react'
import { formatDuration } from '../../lib/activityByCategoryWidgetHelpers'

export const FOCUSED = '#22c55e'
export const DISTRACTED = '#f43f5e'
export const UNCERTAIN = '#f59e0b'

export interface DurationPoint {
  label: string
  focusedMs: number
  distractedMs: number
  uncertainMs: number
  appSwitches?: number
  categoryTotals?: Array<{ name: string; color: string; durationMs: number }>
}

const chartDuration = (value: number) => `${Math.round((value / 3_600_000) * 10) / 10}h`
const total = (point: DurationPoint) => point.focusedMs + point.distractedMs + point.uncertainMs

function Tooltip({ children }: { children: string }) {
  return <title>{children}</title>
}

export function ProductivityLineChart({ points, currentIndex, averageMs }: { points: DurationPoint[]; currentIndex?: number; averageMs?: number | null }) {
  const gradientId = useId().replace(/:/g, '')
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(60 * 60 * 1000, ...points.map((point) => point.focusedMs), averageMs || 0)
  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? 50 : 8 + (index / (points.length - 1)) * 84
    const y = 80 - (point.focusedMs / max) * 58
    return { x, y }
  })
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(' ')
  const area = `8,82 ${line} 92,82`
  const averageY = averageMs === null || averageMs === undefined ? null : 80 - (averageMs / max) * 58

  return (
    <div className="relative h-44 w-full" aria-label="Focused time this week">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible" role="img">
        <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop stopColor={FOCUSED} stopOpacity=".26" /><stop offset="1" stopColor={FOCUSED} stopOpacity="0" /></linearGradient></defs>
        {[24, 53, 82].map((y) => <line key={y} x1="8" x2="92" y1={y} y2={y} stroke="currentColor" className="text-border" strokeWidth=".45" />)}
        {averageY !== null && <line x1="8" x2="92" y1={averageY} y2={averageY} stroke="currentColor" className="text-muted-foreground" strokeDasharray="1.5 1.5" strokeWidth=".65" />}
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline points={line} fill="none" stroke={FOCUSED} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        {coordinates.map((point, index) => (
          <g key={points[index].label} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)} tabIndex={0} role="img" aria-label={`${points[index].label}: ${formatDuration(points[index].focusedMs)} focused`}>
            <Tooltip>{`${points[index].label}: ${formatDuration(points[index].focusedMs)} focused`}</Tooltip>
            {currentIndex === index && <line x1={point.x} x2={point.x} y1="12" y2="84" stroke="currentColor" className="text-muted-foreground" strokeWidth=".5" />}
            <circle cx={point.x} cy={point.y} r={hovered === index || currentIndex === index ? '2.6' : '1.6'} fill={FOCUSED} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-x-[8%] bottom-0 flex justify-between text-[11px] text-muted-foreground">
        {points.map((point) => <span key={point.label}>{point.label}</span>)}
      </div>
      {hovered !== null && <div className="absolute right-2 top-1 rounded-md border bg-popover px-2 py-1 text-xs shadow-sm">{points[hovered].label} · {formatDuration(points[hovered].focusedMs)} focused</div>}
      {averageMs !== null && averageMs !== undefined && <span className="absolute left-2 top-1 text-[11px] text-muted-foreground">Average {formatDuration(averageMs)}</span>}
    </div>
  )
}

export function StackedDurationBars({ points, mode = 'state' }: { points: DurationPoint[]; mode?: 'state' | 'category' }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(1, ...points.map(total))
  return (
    <div className="flex h-64 items-end gap-2 border-b border-border px-1 pt-5" aria-label="Daily activity durations">
      {points.map((point, index) => {
        const pointTotal = total(point)
        const height = Math.max(pointTotal ? 8 : 0, (pointTotal / max) * 100)
        const segments = mode === 'category' && point.categoryTotals?.length
          ? point.categoryTotals.map((category) => ({ value: category.durationMs, color: category.color }))
          : [{ value: point.focusedMs, color: FOCUSED }, { value: point.distractedMs, color: DISTRACTED }, { value: point.uncertainMs, color: UNCERTAIN }]
        return <div key={point.label} className="relative flex h-full min-w-0 flex-1 flex-col justify-end" onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)}>
          {hovered === index && <div className="absolute bottom-[calc(100%+6px)] left-1/2 z-10 w-max max-w-44 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-center text-xs shadow-md"><strong>{point.label}</strong><br />{formatDuration(point.focusedMs)} focused · {formatDuration(point.distractedMs)} distracted{point.uncertainMs > 0 ? ` · ${formatDuration(point.uncertainMs)} uncertain` : ''}</div>}
          <div className="mx-auto flex w-full max-w-12 flex-col-reverse overflow-hidden rounded-t-lg transition-all" style={{ height: `${height}%` }} tabIndex={0} aria-label={`${point.label}: ${formatDuration(pointTotal)} tracked`}>
            {segments.map((segment, segmentIndex) => segment.value > 0 && <div key={segmentIndex} style={{ height: `${(segment.value / pointTotal) * 100}%`, backgroundColor: segment.color }} />)}
          </div>
          <span className="mt-2 truncate text-center text-[11px] text-muted-foreground">{point.label}</span>
        </div>
      })}
    </div>
  )
}

export function MetricBars({ points, label, valueForPoint, formatValue }: { points: DurationPoint[]; label: string; valueForPoint: (point: DurationPoint) => number; formatValue: (value: number) => string }) {
  const max = Math.max(1, ...points.map(valueForPoint))
  return <div className="space-y-3"><div className="flex items-baseline justify-between"><h3 className="text-base font-semibold">{label}</h3><span className="text-xs text-muted-foreground">{formatValue(Math.round(points.reduce((sum, point) => sum + valueForPoint(point), 0) / Math.max(1, points.length)))}/day average</span></div><div className="flex h-40 items-end gap-2 border-b border-border px-1">{points.map((point) => <div key={point.label} className="flex h-full min-w-0 flex-1 flex-col justify-end"><div className="mx-auto w-full max-w-12 rounded-t-md bg-sky-500/75 transition-all" style={{ height: `${Math.max(valueForPoint(point) ? 6 : 0, (valueForPoint(point) / max) * 100)}%` }} title={`${point.label}: ${formatValue(valueForPoint(point))}`} /><span className="mt-2 truncate text-center text-[11px] text-muted-foreground">{point.label}</span></div>)}</div></div>
}

export function FocusRhythmChart({ hours }: { hours: Array<{ hour: number; focusedMs: number; distractedMs: number; uncertainMs: number }> }) {
  const max = Math.max(1, ...hours.map((hour) => hour.focusedMs + hour.distractedMs + hour.uncertainMs))
  return <div className="flex h-36 items-end gap-px border-b border-border px-1">{hours.map((hour) => {
    const totalMs = hour.focusedMs + hour.distractedMs + hour.uncertainMs
    return <div key={hour.hour} className="group relative flex h-full min-w-0 flex-1 flex-col-reverse overflow-hidden rounded-t-sm" style={{ height: `${Math.max(totalMs ? 5 : 0, (totalMs / max) * 100)}%` }} title={`${String(hour.hour).padStart(2, '0')}:00 · ${formatDuration(hour.focusedMs)} focused, ${formatDuration(hour.distractedMs)} distracted`}>
      {hour.uncertainMs > 0 && <div style={{ height: `${(hour.uncertainMs / totalMs) * 100}%`, backgroundColor: UNCERTAIN }} />}
      {hour.distractedMs > 0 && <div style={{ height: `${(hour.distractedMs / totalMs) * 100}%`, backgroundColor: DISTRACTED }} />}
      {hour.focusedMs > 0 && <div style={{ height: `${(hour.focusedMs / totalMs) * 100}%`, backgroundColor: FOCUSED }} />}
    </div>
  })}</div>
}

export const formatHours = chartDuration
