import type { inferRouterOutputs } from '@trpc/server'
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Compass,
  Flame,
  Layers,
  Lightbulb,
  Repeat2,
  Shuffle,
  Target,
  TrendingUp,
  Waves
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import AppIcon from '../components/AppIcon'
import { DayBars, DEEP, DISTRACT, FOCUS, FocusHeatmap, formatHour, Meter, percent, Ring, StaminaHistogram, Swatch, type DayColumn } from '../components/analytics/InsightCharts'
import { Button } from '../components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group'
import { useAuth } from '../contexts/AuthContext'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import { trpc, type AppRouter } from '../utils/trpc'

type Insights = inferRouterOutputs<AppRouter>['analytics']['getInsights']
type Suggestion = Insights['suggestions'][number]
type RangeMode = 'week' | 'month'

const MINUTE = 60_000

const startOfWeek = (value: Date) => {
  const date = new Date(value)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  date.setHours(0, 0, 0, 0)
  return date
}
const rangeFor = (anchor: Date, mode: RangeMode) => {
  const start = mode === 'week' ? startOfWeek(anchor) : new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const end = new Date(start)
  const previous = new Date(start)
  if (mode === 'week') {
    end.setDate(end.getDate() + 7)
    previous.setDate(previous.getDate() - 7)
  } else {
    end.setMonth(end.getMonth() + 1)
    previous.setMonth(previous.getMonth() - 1)
  }
  return { start, end, previous }
}
const labelRange = (start: Date, end: Date, mode: RangeMode) =>
  mode === 'week'
    ? `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(end.getTime() - 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

const minutesText = (ms: number) => formatDuration(Math.round(ms / MINUTE) * MINUTE)

function Delta({ current, previous, kind = 'duration', invert = false }: { current: number | null; previous: number | null; kind?: 'duration' | 'points' | 'count'; invert?: boolean }) {
  if (current === null || previous === null || (kind !== 'points' && previous === 0)) return <span className="text-[11px] text-muted-foreground">no earlier data</span>
  const diff = current - previous
  const neutral = kind === 'points' ? Math.abs(diff) < 0.01 : kind === 'count' ? diff === 0 : Math.abs(diff) < MINUTE
  if (neutral) return <span className="text-[11px] text-muted-foreground">same as before</span>
  const better = invert ? diff < 0 : diff > 0
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight
  const text = kind === 'points' ? `${Math.abs(Math.round(diff * 100))} pts` : kind === 'count' ? String(Math.abs(diff)) : minutesText(Math.abs(diff))
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
      <Icon size={13} style={{ color: better ? FOCUS : DISTRACT }} aria-hidden />
      <span className="font-medium text-foreground">{text}</span>
      <span>{diff > 0 ? 'more' : 'less'}</span>
    </span>
  )
}

function Stat({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="tempo-insight-tile px-3.5 py-3">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-[22px] font-semibold leading-tight tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 min-h-[16px]">{children}</div>
    </div>
  )
}

function Section({ icon, title, subtitle, children, className = '', aside }: { icon: ReactNode; title: string; subtitle?: string; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <section className={`tempo-insight-card p-5 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 text-muted-foreground">{icon}</div>
          <div>
            <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Takeaway({ children }: { children: ReactNode }) {
  return <p className="mt-4 rounded-[10px] bg-[var(--glass-track)] px-3 py-2 text-xs leading-relaxed text-muted-foreground">{children}</p>
}

const suggestionIcon = (kind: Suggestion['kind']) => {
  const props = { size: 16 }
  switch (kind) {
    case 'schedule':
      return <CalendarClock {...props} />
    case 'session':
      return <Target {...props} />
    case 'distraction':
      return <Compass {...props} />
    case 'switching':
      return <Shuffle {...props} />
    case 'planning':
      return <Layers {...props} />
    default:
      return <TrendingUp {...props} />
  }
}

const appNameFromKey = (key: string) => key.split(':')[1] || key

export function AnalysisPage() {
  const { token } = useAuth()
  const [mode, setMode] = useState<RangeMode>('week')
  const [anchor, setAnchor] = useState(new Date())
  const { start, end, previous } = useMemo(() => rangeFor(anchor, mode), [anchor, mode])
  const { data, isLoading } = trpc.analytics.getInsights.useQuery(
    { token: token || '', startDateMs: start.getTime(), endDateMs: end.getTime(), previousStartDateMs: previous.getTime() },
    { enabled: !!token, keepPreviousData: true, refetchInterval: 60_000 }
  )
  const now = Date.now()
  const inProgress = now < end.getTime()
  const isCurrent = rangeFor(new Date(), mode).start.getTime() <= start.getTime()
  const periodWord = mode === 'week' ? 'week' : 'month'
  const comparisonLabel = inProgress ? `at this point last ${periodWord}` : `last ${periodWord}`

  const navigate = (direction: -1 | 1) =>
    setAnchor((current) => {
      const next = new Date(current)
      if (mode === 'week') next.setDate(next.getDate() + direction * 7)
      else next.setMonth(next.getMonth() + direction)
      return next
    })

  const columns = useMemo<DayColumn[]>(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return (data?.days || []).map((day) => {
      const date = new Date(day.startDateMs)
      return {
        key: day.startDateMs,
        label: mode === 'week' ? date.toLocaleDateString(undefined, { weekday: 'short' }) : String(date.getDate()),
        longLabel: date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
        deepWorkMs: day.deepWorkMs,
        focusedMs: day.focusedMs,
        distractedMs: day.distractedMs,
        isFuture: day.startDateMs > today.getTime(),
        isToday: day.startDateMs === today.getTime()
      }
    })
  }, [data, mode])

  const summary = data?.summary
  const prior = data?.previous
  const hasData = !!summary && summary.trackedMs > 0
  const activeColumns = columns.filter((column) => column.focusedMs + column.distractedMs > 0)
  const averageFocus = activeColumns.length ? activeColumns.reduce((sum, column) => sum + column.focusedMs, 0) / activeColumns.length : null
  const bestDay = [...activeColumns].sort((a, b) => b.focusedMs - a.focusedMs)[0]

  const headline = (() => {
    if (!summary) return { title: 'Reading your activity…', detail: '' }
    if (!hasData) return { title: `Nothing tracked this ${periodWord} yet.`, detail: 'Once Tempo has seen some work, this page explains when you focus best, what pulls you away and what to try next.' }
    const diff = prior && prior.focusedMs > 0 ? summary.focusedMs - prior.focusedMs : null
    const comparison = diff === null ? '' : Math.abs(diff) < 5 * MINUTE ? `, about the same as ${comparisonLabel}` : `, ${minutesText(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than ${comparisonLabel}`
    const title = `You focused ${minutesText(summary.focusedMs)} this ${periodWord}${comparison}.`
    const parts: string[] = []
    if (data?.goldenWindow) parts.push(`Your strongest hours were ${formatHour(data.goldenWindow.startHour)}–${formatHour(data.goldenWindow.endHour)}`)
    if (summary.deepBlocks) parts.push(`${summary.deepBlocks} block${summary.deepBlocks === 1 ? '' : 's'} ran 25 minutes or longer`)
    else parts.push('no focus block reached 25 minutes yet')
    if (bestDay && mode === 'week') parts.push(`${new Date(bestDay.key).toLocaleDateString(undefined, { weekday: 'long' })} was your best day`)
    const detail = parts.length ? `${parts.join(', ').replace(/^./, (letter) => letter.toUpperCase())}.` : ''
    return { title, detail }
  })()

  const distractions = data?.distractions
  const sessions = data?.sessions
  const stamina = data?.stamina
  const switching = data?.switching
  const maxSource = Math.max(0, ...(distractions?.sources || []).map((source) => source.distractedMs))
  const maxTask = Math.max(0, ...(sessions?.tasks || []).map((task) => task.focusedMs))

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="xs" onClick={() => navigate(-1)} aria-label={`Previous ${periodWord}`}>
              <ChevronLeft size={17} />
            </Button>
            <button type="button" onClick={() => setAnchor(new Date())} className="min-w-[150px] rounded-md px-2 py-1 text-center text-[13px] font-semibold tracking-tight hover:bg-[var(--glass-hover)]" title={`Jump to this ${periodWord}`}>
              {labelRange(start, end, mode)}
            </button>
            <Button variant="ghost" size="xs" onClick={() => navigate(1)} aria-label={`Next ${periodWord}`} disabled={isCurrent}>
              <ChevronRight size={17} />
            </Button>
          </div>
          <ToggleGroup type="single" size="sm" className="tempo-glass-segmented" value={mode} onValueChange={(value) => value && setMode(value as RangeMode)}>
            <ToggleGroupItem value="week" className="px-3 text-xs">Week</ToggleGroupItem>
            <ToggleGroupItem value="month" className="px-3 text-xs">Month</ToggleGroupItem>
          </ToggleGroup>
        </section>

        <section className="tempo-insight-card tempo-insight-hero p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-muted-foreground">Your {periodWord} in focus</p>
          <h2 className="mt-1.5 max-w-3xl text-[22px] font-semibold leading-snug tracking-tight">{headline.title}</h2>
          {headline.detail && <p className="mt-1.5 max-w-3xl text-[13px] text-muted-foreground">{headline.detail}</p>}
          {hasData && summary && prior && (
            <div className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Focused time" value={minutesText(summary.focusedMs)}>
                <Delta current={summary.focusedMs} previous={prior.trackedMs ? prior.focusedMs : null} />
              </Stat>
              <Stat label="Focus rate" value={percent(summary.focusRate)}>
                <Delta current={summary.focusRate} previous={prior.focusRate} kind="points" />
              </Stat>
              <Stat label="Deep work" value={minutesText(summary.deepWorkMs)}>
                <span className="text-[11px] text-muted-foreground">
                  {summary.deepBlocks} block{summary.deepBlocks === 1 ? '' : 's'} of 25 min+
                  {prior.trackedMs > 0 && <> · <Delta current={summary.deepWorkMs} previous={prior.deepWorkMs || null} /></>}
                </span>
              </Stat>
              <Stat label="Longest block" value={summary.longestBlockMs ? minutesText(summary.longestBlockMs) : '—'}>
                <Delta current={summary.longestBlockMs} previous={prior.longestBlockMs || null} />
              </Stat>
            </div>
          )}
        </section>

        {!!data?.suggestions.length && (
          <section>
            <div className="mb-2 flex items-center gap-2 px-1">
              <Lightbulb size={15} className="text-amber-500" />
              <h2 className="text-[13px] font-semibold tracking-tight">What to try next</h2>
            </div>
            <div className="grid gap-2.5 md:grid-cols-3">
              {data.suggestions.map((suggestion) => (
                <article key={suggestion.id} className="tempo-insight-suggestion p-4">
                  <div className="mb-2 inline-flex size-7 items-center justify-center rounded-lg bg-[var(--glass-track)] text-foreground">{suggestionIcon(suggestion.kind)}</div>
                  <h3 className="text-[13px] font-semibold leading-snug">{suggestion.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{suggestion.body}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {hasData && data && (
          <>
            <Section
              icon={<Flame size={16} />}
              title="Day by day"
              subtitle="How much you focused, and how much of it was deep work."
              aside={
                <div className="hidden flex-wrap gap-3 text-[11px] text-muted-foreground sm:flex">
                  <Swatch color={DEEP} label="Deep work (25 min+ blocks)" />
                  <Swatch color={FOCUS} label="Other focus" />
                  <Swatch color={DISTRACT} label="Distracted" />
                </div>
              }
            >
              <DayBars days={columns} averageFocusMs={averageFocus} />
              <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground sm:hidden">
                <Swatch color={DEEP} label="Deep work" />
                <Swatch color={FOCUS} label="Other focus" />
                <Swatch color={DISTRACT} label="Distracted" />
              </div>
            </Section>

            <div className="grid gap-4 lg:grid-cols-5">
              <Section icon={<CalendarClock size={16} />} title="When you focus best" subtitle={mode === 'week' ? 'Focused minutes per hour.' : 'Average focused minutes per hour, by weekday.'} className="lg:col-span-3">
                <FocusHeatmap focusedMs={data.heatmap.focusedMs} distractedMs={data.heatmap.distractedMs} weekdayDays={data.heatmap.weekdayDays} golden={data.goldenWindow} />
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    Less
                    {[0.2, 0.45, 0.7, 1].map((step) => (
                      <i key={step} className="inline-block size-2.5 rounded-[3px]" style={{ background: `color-mix(in srgb, ${FOCUS} ${Math.round(18 + step * 82)}%, transparent)` }} />
                    ))}
                    More focus
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <i className="inline-block size-[6px] rounded-full" style={{ background: DISTRACT }} />
                    Mostly distracted
                  </span>
                </div>
                <Takeaway>
                  {data.goldenWindow ? (
                    <>
                      <span className="font-medium text-foreground">
                        {formatHour(data.goldenWindow.startHour)}–{formatHour(data.goldenWindow.endHour)}
                      </span>{' '}
                      held {percent(data.goldenWindow.shareOfFocus)} of your focused time at a {percent(data.goldenWindow.focusRate)} focus rate.
                      {data.driftHour && data.driftHour.distractionShare >= 0.3 && (
                        <>
                          {' '}
                          Around <span className="font-medium text-foreground">{formatHour(data.driftHour.hour)}</span> you drift most ({percent(data.driftHour.distractionShare)} distracted).
                        </>
                      )}
                    </>
                  ) : (
                    'Not enough focused time yet to name your best hours.'
                  )}
                </Takeaway>
              </Section>

              <Section icon={<Waves size={16} />} title="Focus stamina" subtitle="How long your focus blocks last before you stop or drift." className="lg:col-span-2">
                {stamina && <StaminaHistogram buckets={stamina.buckets} medianMs={stamina.medianBlockMs} />}
                <Takeaway>
                  {stamina?.medianBlockMs ? (
                    <>
                      Your focus typically holds for <span className="font-medium text-foreground">{minutesText(stamina.medianBlockMs)}</span> before you drift.
                      {sessions?.medianFirstDriftMs ? <> In timed sessions you usually get about {minutesText(sessions.medianFirstDriftMs)} of focus in before the first drift.</> : null}
                    </>
                  ) : (
                    'A few more focus blocks are needed to estimate your stamina.'
                  )}
                </Takeaway>
              </Section>
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <Section icon={<Compass size={16} />} title="What pulls you away" subtitle="Distracted time by app or kind of website." className="lg:col-span-3">
                {distractions && distractions.sources.length ? (
                  <ul className="space-y-3">
                    {distractions.sources.map((source) => (
                      <li key={source.key} className="flex items-center gap-3">
                        <AppIcon appName={appNameFromKey(source.key)} size={26} className="shrink-0 rounded-md" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-[13px] font-medium">{source.label}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              <span className="font-medium text-foreground">{minutesText(source.distractedMs)}</span> · {source.episodes} detour{source.episodes === 1 ? '' : 's'}
                            </span>
                          </div>
                          {source.examples.length > 0 && <div className="truncate text-[11px] text-muted-foreground">{source.examples.join(', ')}</div>}
                          <div className="mt-1.5">
                            <Meter value={source.distractedMs} max={maxSource} color={DISTRACT} />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No distracted time in this period. Nicely done.</p>
                )}
              </Section>

              <Section icon={<Repeat2 size={16} />} title="Detours and recovery" subtitle="What a typical distraction looks like." className="lg:col-span-2">
                {distractions && distractions.episodes ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="tempo-insight-tile px-3 py-2.5">
                        <div className="text-[11px] text-muted-foreground">Detours</div>
                        <div className="text-lg font-semibold tabular-nums">{distractions.episodes}</div>
                      </div>
                      <div className="tempo-insight-tile px-3 py-2.5">
                        <div className="text-[11px] text-muted-foreground">Typical length</div>
                        <div className="text-lg font-semibold tabular-nums">{distractions.medianDetourMs !== null ? formatDuration(distractions.medianDetourMs) : '—'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Ring value={distractions.returnRate}>{percent(distractions.returnRate)}</Ring>
                      <p className="text-xs leading-relaxed text-muted-foreground">of detours ended with you going straight back to focused work.</p>
                    </div>
                    {summary && summary.distractedMs > 0 && (
                      <div className="flex items-center gap-3">
                        <Ring value={distractions.longDetourMs / summary.distractedMs} color={DISTRACT}>
                          {percent(distractions.longDetourMs / summary.distractedMs)}
                        </Ring>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          of distracted time came from {distractions.longDetours} long detour{distractions.longDetours === 1 ? '' : 's'} of 10 minutes or more.
                        </p>
                      </div>
                    )}
                    {distractions.gateways.length > 0 && (
                      <div>
                        <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Drifts usually start right after</div>
                        <div className="flex flex-wrap gap-1.5">
                          {distractions.gateways.map((gateway) => (
                            <span key={gateway.key} className="tempo-insight-tile inline-flex items-center gap-1.5 px-2 py-1 text-xs">
                              <AppIcon appName={appNameFromKey(gateway.key)} size={14} />
                              {gateway.label}
                              <span className="tabular-nums text-muted-foreground">{gateway.episodes}×</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No detours to analyse.</p>
                )}
              </Section>
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <Section icon={<Target size={16} />} title="Focus sessions" subtitle="How your timed sessions actually went." className="lg:col-span-3">
                {sessions && sessions.count ? (
                  <div className="space-y-5">
                    <div className="flex flex-wrap items-center gap-5">
                      <div className="flex items-center gap-3">
                        <Ring value={sessions.count ? sessions.completed / sessions.count : null} size={60}>
                          {sessions.completed}/{sessions.count}
                        </Ring>
                        <div className="text-xs text-muted-foreground">
                          <div className="font-medium text-foreground">sessions finished</div>
                          {sessions.cancelled ? `${sessions.cancelled} stopped early` : 'none stopped early'}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Ring value={sessions.focusRate} size={60}>{percent(sessions.focusRate)}</Ring>
                        <div className="text-xs text-muted-foreground">
                          <div className="font-medium text-foreground">focus inside sessions</div>
                          vs {percent(summary?.focusRate)} overall
                        </div>
                      </div>
                      {sessions.estimate && (
                        <div className="tempo-insight-tile px-3 py-2">
                          <div className="text-[11px] text-muted-foreground">Actual vs estimate</div>
                          <div className="text-lg font-semibold tabular-nums">{sessions.estimate.medianRatio.toFixed(1)}×</div>
                          <div className="text-[10px] text-muted-foreground">over {sessions.estimate.samples} tasks</div>
                        </div>
                      )}
                    </div>
                    {sessions.byLength.some((bucket) => bucket.count > 0) && (
                      <div>
                        <div className="mb-2 text-[11px] font-medium text-muted-foreground">Focus rate by planned session length</div>
                        <div className="space-y-2">
                          {sessions.byLength
                            .filter((bucket) => bucket.count > 0)
                            .map((bucket) => (
                              <div key={bucket.label} className="grid grid-cols-[92px_1fr_72px] items-center gap-3 text-xs">
                                <span className="text-muted-foreground">{bucket.label}</span>
                                <Meter value={bucket.focusRate || 0} max={1} color={FOCUS} />
                                <span className="text-right tabular-nums">
                                  <span className="font-medium">{percent(bucket.focusRate)}</span>
                                  <span className="text-muted-foreground"> · {bucket.count}</span>
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No focus sessions in this period. Start one from the toolbar to see how sessions compare with free time.</p>
                )}
              </Section>

              <Section icon={<Layers size={16} />} title="Where your focus went" subtitle="Focused time inside sessions, by task." className="lg:col-span-2">
                {sessions && sessions.tasks.length ? (
                  <ul className="space-y-3">
                    {sessions.tasks.map((task) => (
                      <li key={task.goal}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="line-clamp-2 text-[13px] font-medium leading-snug" title={task.goal}>{task.goal}</span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            <span className="font-medium text-foreground">{minutesText(task.focusedMs)}</span> · {percent(task.focusRate)}
                          </span>
                        </div>
                        <div className="mt-1.5">
                          <Meter value={task.focusedMs} max={maxTask} color={FOCUS} />
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {task.sessions} session{task.sessions === 1 ? '' : 's'} · {minutesText(task.workMs)} on the clock
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Tasks appear here once you run sessions with a goal.</p>
                )}
              </Section>
            </div>

            {switching && switching.perTrackedHour !== null && (
              <Section icon={<Shuffle size={16} />} title="Context switching" subtitle="Changes between apps. Browser tabs are not counted.">
                <div className="flex flex-wrap items-center gap-6">
                  <div>
                    <div className="text-[22px] font-semibold tabular-nums">{switching.perTrackedHour.toFixed(0)}</div>
                    <div className="text-[11px] text-muted-foreground">app switches per active hour</div>
                    {switching.previousPerTrackedHour !== null && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {Math.round(switching.perTrackedHour) === Math.round(switching.previousPerTrackedHour)
                          ? `same as ${comparisonLabel}`
                          : `${Math.round(switching.previousPerTrackedHour)} per hour ${comparisonLabel}`}
                      </div>
                    )}
                  </div>
                  {switching.calmerDays && switching.busierDays ? (
                    <div className="min-w-[260px] flex-1 space-y-2 text-xs">
                      <div className="grid grid-cols-[110px_1fr_44px] items-center gap-3">
                        <span className="text-muted-foreground">Calmer days</span>
                        <Meter value={switching.calmerDays.focusRate} max={1} color={FOCUS} />
                        <span className="text-right font-medium tabular-nums">{percent(switching.calmerDays.focusRate)}</span>
                      </div>
                      <div className="grid grid-cols-[110px_1fr_44px] items-center gap-3">
                        <span className="text-muted-foreground">Busiest days</span>
                        <Meter value={switching.busierDays.focusRate} max={1} color={FOCUS} />
                        <span className="text-right font-medium tabular-nums">{percent(switching.busierDays.focusRate)}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">Focus rate on the days with the fewest and the most switches per hour.</p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">A few more active days are needed to compare calm and busy days.</p>
                  )}
                </div>
              </Section>
            )}
          </>
        )}

        {isLoading && !data && <div className="tempo-insight-card h-40 animate-pulse" />}
        <p className="px-1 pb-2 text-[11px] text-muted-foreground">
          Calculated on this Mac from classified activity. A glance away of up to two minutes does not break a focus block.
        </p>
      </div>
    </main>
  )
}
