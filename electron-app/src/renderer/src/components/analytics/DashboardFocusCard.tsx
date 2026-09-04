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
  const { data, isLoading } = trpc.analytics.getPeriod.useQuery({ token: token || '', startDateMs: start.getTime(), endDateMs: end.getTime(), comparisonAtMs: now.getTime() }, { enabled: !!token, refetchInterval: 30_000 })
  const points = useMemo<DurationPoint[]>(() => (data?.days || []).map((day: any) => ({ label: new Date(day.startDateMs).toLocaleDateString(undefined, { weekday: 'short' }), focusedMs: day.focusedMs, distractedMs: day.distractedMs, uncertainMs: day.uncertainMs })), [data])
  const today = data?.days.find((day: any) => new Date(day.startDateMs).toDateString() === now.toDateString())
  const usual = data?.usualByNow?.focusedMs
  const delta = today && usual !== null && usual !== undefined ? today.focusedMs - usual : null
  const currentIndex = points.findIndex((point) => point.label === now.toLocaleDateString(undefined, { weekday: 'short' }))

  return <Card className="mb-4 overflow-hidden border-emerald-500/15 bg-gradient-to-br from-emerald-500/[0.08] via-card to-card"><CardContent className="p-4"><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-medium uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">Focus this week</p><div className="mt-1 flex items-baseline gap-2"><span className="text-3xl font-semibold tracking-tight">{isLoading ? '—' : formatDuration(today?.focusedMs || 0)}</span><span className="text-sm text-muted-foreground">focused today</span></div></div>{usual !== null && usual !== undefined ? <div className="flex items-center gap-1 text-xs text-muted-foreground">{delta !== null && delta >= 0 ? <TrendingUp size={14} className="text-emerald-500" /> : <TrendingDown size={14} className="text-rose-500" />}<span>{Math.abs(delta || 0) < 60_000 ? 'On pace with' : `${formatDuration(Math.abs(delta || 0))} ${delta && delta >= 0 ? 'ahead of' : 'behind'}`} your usual {now.toLocaleDateString(undefined, { weekday: 'long' })}</span></div> : <span className="text-xs text-muted-foreground">Track a few matching weekdays to see your usual pace.</span>}</div><ProductivityLineChart points={points} currentIndex={currentIndex >= 0 ? currentIndex : undefined} averageMs={usual} /><p className="mt-1 text-xs text-muted-foreground">{data?.usualByNow?.sampleCount ? `Usual by now is based on ${data.usualByNow.sampleCount} earlier matching active weekday${data.usualByNow.sampleCount === 1 ? '' : 's'}.` : 'Calendar-day focus time · local only'}</p></CardContent></Card>
}
