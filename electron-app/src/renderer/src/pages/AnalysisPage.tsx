import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, Layers3, LineChart, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import { trpc } from '../utils/trpc'
import { FocusRhythmChart, MetricBars, ProductivityLineChart, StackedDurationBars, type DurationPoint } from '../components/analytics/AnalyticsCharts'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group'

type RangeMode = 'week' | 'month'

const startOfWeek = (value: Date) => {
  const date = new Date(value)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  date.setHours(0, 0, 0, 0)
  return date
}
const startOfMonth = (value: Date) => new Date(value.getFullYear(), value.getMonth(), 1)
const rangeFor = (anchor: Date, mode: RangeMode) => {
  const start = mode === 'week' ? startOfWeek(anchor) : startOfMonth(anchor)
  const end = new Date(start)
  if (mode === 'week') end.setDate(end.getDate() + 7)
  else end.setMonth(end.getMonth() + 1)
  return { start, end }
}

const labelRange = (start: Date, end: Date, mode: RangeMode) => mode === 'week'
  ? `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}–${new Date(end.getTime() - 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  : start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

export function AnalysisPage() {
  const { token } = useAuth()
  const [mode, setMode] = useState<RangeMode>('week')
  const [anchor, setAnchor] = useState(new Date())
  const [barMode, setBarMode] = useState<'state' | 'category'>('state')
  const { start, end } = useMemo(() => rangeFor(anchor, mode), [anchor, mode])
  const { data, isLoading } = trpc.analytics.getPeriod.useQuery({ token: token || '', startDateMs: start.getTime(), endDateMs: end.getTime() }, { enabled: !!token })
  const points = useMemo<DurationPoint[]>(() => (data?.days || []).map((day: any) => ({
    label: mode === 'week' ? new Date(day.startDateMs).toLocaleDateString(undefined, { weekday: 'short' }) : String(new Date(day.startDateMs).getDate()),
    focusedMs: day.focusedMs,
    distractedMs: day.distractedMs,
    uncertainMs: day.uncertainMs,
    appSwitches: day.appSwitches,
    categoryTotals: day.categoryTotals
  })), [data, mode])
  const totals = data?.totals
  const focusRatio = totals?.trackedMs ? Math.round((totals.focusedMs / totals.trackedMs) * 100) : 0
  const activeDays = points.filter((point) => point.focusedMs + point.distractedMs + point.uncertainMs > 0)
  const averageFocus = activeDays.length ? Math.round((totals?.focusedMs || 0) / activeDays.length) : 0
  const bestDay = [...points].sort((a, b) => b.focusedMs - a.focusedMs)[0]
  const navigate = (direction: -1 | 1) => setAnchor((current) => {
    const next = new Date(current)
    if (mode === 'week') next.setDate(next.getDate() + direction * 7)
    else next.setMonth(next.getMonth() + direction)
    return next
  })
  const current = () => setAnchor(new Date())
  const maxFocused = Math.max(0, ...points.map((point) => point.focusedMs))

  return <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-6"><div className="mx-auto max-w-6xl space-y-4"><section className="flex flex-wrap items-center justify-between gap-3 pt-1"><div><h1 className="text-xl font-semibold tracking-tight">Analysis</h1><p className="text-sm text-muted-foreground">Calendar-day activity patterns, calculated locally.</p></div><div className="flex items-center gap-2"><Button variant="outline" size="xs" onClick={() => navigate(-1)} aria-label="Previous period"><ChevronLeft size={18} /></Button><Button variant="outline" size="sm" onClick={current}>{labelRange(start, end, mode)}</Button><Button variant="outline" size="xs" onClick={() => navigate(1)} aria-label="Next period" disabled={rangeFor(new Date(), mode).start.getTime() <= start.getTime()}><ChevronRight size={18} /></Button><ToggleGroup type="single" value={mode} onValueChange={(value) => value && setMode(value as RangeMode)} variant="outline" size="sm"><ToggleGroupItem value="week" aria-label="Week analysis"><CalendarDays size={16} /></ToggleGroupItem><ToggleGroupItem value="month" aria-label="Month analysis"><LineChart size={16} /></ToggleGroupItem></ToggleGroup></div></section>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[
      ['Focused time', formatDuration(totals?.focusedMs || 0), 'productive activity'],
      ['Focus ratio', `${focusRatio}%`, 'of tracked time'],
      ['Average focus', formatDuration(averageFocus), activeDays.length ? `across ${activeDays.length} active days` : 'no active days'],
      ['App switches', String(totals?.appSwitches || 0), 'application changes only'],
      ['Best day', bestDay?.focusedMs ? `${bestDay.label} · ${formatDuration(bestDay.focusedMs)}` : '—', 'most focused time']
    ].map(([label, value, note]) => <Card key={label} className="border-border/80"><CardContent className="p-4"><p className="text-xs font-medium uppercase tracking-[.12em] text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold tracking-tight">{isLoading ? '—' : value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></CardContent></Card>)}</section>
    <Card><CardContent className="p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-semibold">Productive hours</h2><p className="text-sm text-muted-foreground">{mode === 'week' ? 'One bar per weekday, split by activity state.' : 'Daily productive trend for the selected month.'}</p></div><ToggleGroup type="single" value={barMode} onValueChange={(value) => value && setBarMode(value as 'state' | 'category')} variant="outline" size="sm"><ToggleGroupItem value="state"><BarChart3 size={15} className="mr-1" />State</ToggleGroupItem><ToggleGroupItem value="category"><Layers3 size={15} className="mr-1" />Category</ToggleGroupItem></ToggleGroup></div><StackedDurationBars points={points} mode={barMode} /><div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground"><span><i className="mr-1 inline-block size-2 rounded-full" style={{ background: '#22c55e' }} />Focused</span><span><i className="mr-1 inline-block size-2 rounded-full" style={{ background: '#f43f5e' }} />Distracted</span><span><i className="mr-1 inline-block size-2 rounded-full" style={{ background: '#f59e0b' }} />Uncertain</span></div></CardContent></Card>
    {mode === 'month' && <Card><CardContent className="p-5"><h2 className="text-lg font-semibold">Productive trend</h2><p className="mb-3 text-sm text-muted-foreground">Daily productive hours through the selected month.</p><ProductivityLineChart points={points} averageMs={activeDays.length ? averageFocus : null} /></CardContent></Card>}
    <section className="grid gap-4 lg:grid-cols-2"><Card><CardContent className="p-5"><MetricBars points={points} label="App switches" valueForPoint={(point) => point.appSwitches || 0} formatValue={(value) => String(value)} /><p className="mt-3 text-xs text-muted-foreground">Counts stable changes between applications; browser tab switches are excluded.</p></CardContent></Card><Card><CardContent className="p-5"><div className="mb-4"><h2 className="text-lg font-semibold">Focus rhythm</h2><p className="text-sm text-muted-foreground">When focused and distracting activity occurred.</p></div><FocusRhythmChart hours={data?.hours || []} /><div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>00:00</span><span>12:00</span><span>23:00</span></div></CardContent></Card></section>
    {mode === 'month' && <Card><CardContent className="p-5"><div className="mb-3 flex items-center gap-2"><Sparkles size={17} className="text-emerald-500" /><h2 className="text-lg font-semibold">Weekday pattern</h2></div><p className="mb-4 text-sm text-muted-foreground">Average focused time for each weekday in this month.</p><MetricBars points={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, weekday) => { const matching = points.filter((_, index) => new Date(start.getFullYear(), start.getMonth(), index + 1).getDay() === (weekday + 1) % 7); const active = matching.filter((point) => point.focusedMs + point.distractedMs + point.uncertainMs > 0); return { label, focusedMs: active.length ? Math.round(active.reduce((sum, point) => sum + point.focusedMs, 0) / active.length) : 0, distractedMs: 0, uncertainMs: 0 } })} label="Average focused time" valueForPoint={(point) => point.focusedMs} formatValue={formatDuration} /></CardContent></Card>}</div></main>
}
