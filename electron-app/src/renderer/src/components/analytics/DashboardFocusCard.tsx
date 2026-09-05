import { TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { formatDuration } from '../../lib/activityByCategoryWidgetHelpers'
import { trpc } from '../../utils/trpc'
import { ProductivityLineChart, type DurationPoint } from './AnalyticsCharts'
import { Card, CardContent } from '../ui/card'

const startOfWeek = (value: Date) => {
  const date = new Date(value)
  const day = date.getDay()
  date.setDate(date.getDate() - ((day + 6) % 7))
  date.setHours(0, 0, 0, 0)
  return date
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
  const { data, isLoading } = trpc.analytics.getPeriod.useQuery({ token: token || '', startDateMs: historyStart.getTime(), endDateMs: end.getTime() }, { enabled: !!token, refetchInterval: 30_000 })
  const currentWeekDays = useMemo(() => (data?.days || []).filter((day: any) => day.startDateMs >= start.getTime() && day.startDateMs < end.getTime()), [data, start, end])
  const points = useMemo<DurationPoint[]>(() => currentWeekDays.map((day: any) => ({ label: new Date(day.startDateMs).toLocaleDateString(undefined, { weekday: 'short' }), focusedMs: day.focusedMs, distractedMs: day.distractedMs, uncertainMs: day.uncertainMs })), [currentWeekDays])
  const today = currentWeekDays.find((day: any) => new Date(day.startDateMs).toDateString() === now.toDateString())
  const usualSamples = useMemo(() => {
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    return (data?.days || []).filter((day: any) => {
      const date = new Date(day.startDateMs)
      return date < new Date(now.getFullYear(), now.getMonth(), now.getDate()) && date.getDay() === now.getDay() && (day.focusedMs + day.distractedMs + day.uncertainMs) > 0 && nowMinutes >= 0
    }).slice(-4)
  }, [data, now])
  // Until the server-side same-clock-time aggregation is requested by a later
  // detailed comparison view, this uses the prior matching active days. The
  // current value remains immediate and never waits for extra work.
  const usual = usualSamples.length ? Math.round(usualSamples.reduce((sum: number, day: any) => sum + day.focusedMs, 0) / usualSamples.length) : null
  const delta = today && usual !== null && usual !== undefined ? today.focusedMs - usual : null
  const currentIndex = points.findIndex((point) => point.label === now.toLocaleDateString(undefined, { weekday: 'short' }))

  return <Card className="mb-3 overflow-hidden border-border bg-card"><CardContent className="p-3"><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">Focus this week</p><div className="mt-1 flex items-baseline gap-2"><span className="text-2xl font-semibold tracking-tight tabular-nums">{isLoading ? '—' : formatDuration(today?.focusedMs || 0)}</span><span className="text-xs text-muted-foreground">focused today</span></div></div>{usual !== null ? <div className="flex items-center gap-1 text-xs text-muted-foreground">{delta !== null && delta >= 0 ? <TrendingUp size={14} className="text-emerald-500" /> : <TrendingDown size={14} className="text-rose-500" />}<span>{Math.abs(delta || 0) < 60_000 ? 'On pace with' : `${formatDuration(Math.abs(delta || 0))} ${delta && delta >= 0 ? 'ahead of' : 'behind'}`} your usual {now.toLocaleDateString(undefined, { weekday: 'long' })}</span></div> : <span className="text-xs text-muted-foreground">Track a few matching weekdays to see your usual pace.</span>}</div><ProductivityLineChart points={points} currentIndex={currentIndex >= 0 ? currentIndex : undefined} averageMs={usual} /><p className="mt-1 text-[11px] text-muted-foreground">{usualSamples.length ? `Usual pace is based on ${usualSamples.length} earlier matching active weekday${usualSamples.length === 1 ? '' : 's'}.` : 'Calendar-day focus time · local only'}</p></CardContent></Card>
}
