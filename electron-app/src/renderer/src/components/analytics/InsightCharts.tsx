import { useMemo, type ReactNode } from 'react'
import { formatDuration } from '../../lib/activityByCategoryWidgetHelpers'

export const DEEP = 'var(--insight-deep)'
export const FOCUS = 'var(--insight-focus)'
export const DISTRACT = 'var(--insight-distract)'
export const BEHIND = 'var(--insight-behind)'

const HOUR = 3_600_000
export const formatHour = (hour: number) => `${String(hour % 24).padStart(2, '0')}:00`
export const percent = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`)
const axisHours = (ms: number) => {
  const hours = ms / HOUR
  return hours >= 1 ? `${Math.round(hours * 10) / 10}h` : `${Math.round(ms / 60_000)}m`
}

/** A small glass tooltip that appears above its `group` parent on hover or keyboard focus. */
export function HoverTip({ children, align = 'center' }: { children: ReactNode; align?: 'center' | 'left' | 'right' }) {
  const position = align === 'left' ? 'left-0' : align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'
  return (
    <div role="tooltip" className={`tempo-glass-surface pointer-events-none absolute bottom-full z-30 mb-2 hidden min-w-[150px] whitespace-nowrap px-3 py-2 text-xs group-hover:block group-focus-visible:block ${position}`}>
      {children}
    </div>
  )
}

export function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className="inline-block size-2.5 rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  )
}

function TipRow({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        {color && <i className="inline-block size-2 rounded-[2px]" style={{ background: color }} />}
        {label}
      </span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  )
}

export interface DayColumn {
  key: number
  label: string
  longLabel: string
  deepWorkMs: number
  focusedMs: number
  distractedMs: number
  isFuture: boolean
  isToday: boolean
}

/**
 * One column per day: deep work at the base, the rest of focused time above
 * it and distracted time on top, so "how much" and "how deep" read together.
 */
export function DayBars({ days, averageFocusMs }: { days: DayColumn[]; averageFocusMs: number | null }) {
  const max = Math.max(HOUR, ...days.map((day) => day.focusedMs + day.distractedMs), averageFocusMs || 0)
  const scale = Math.ceil(max / HOUR) * HOUR
  const dense = days.length > 10
  return (
    <div className="relative">
      <div className="relative flex h-48 items-end gap-[3px] pl-9">
        {[1, 0.5, 0].map((fraction) => (
          <div key={fraction} className="pointer-events-none absolute left-9 right-0 border-t border-border/60" style={{ bottom: `${fraction * 100}%` }}>
            <span className="absolute -left-9 -top-2 w-7 text-right text-[10px] tabular-nums text-muted-foreground">{fraction ? axisHours(scale * fraction) : '0'}</span>
          </div>
        ))}
        {averageFocusMs !== null && averageFocusMs > 0 && (
          <div className="pointer-events-none absolute left-9 right-0 z-10 border-t border-dashed border-foreground/35" style={{ bottom: `${(averageFocusMs / scale) * 100}%` }}>
            <span className="absolute -top-4 right-0 text-[10px] text-muted-foreground">avg focus {formatDuration(averageFocusMs)}</span>
          </div>
        )}
        {days.map((day, index) => {
          const otherFocus = Math.max(0, day.focusedMs - day.deepWorkMs)
          const segments = [
            { color: DEEP, ms: day.deepWorkMs },
            { color: FOCUS, ms: otherFocus },
            { color: DISTRACT, ms: day.distractedMs },
          ].filter((segment) => segment.ms > 0)
          const total = day.focusedMs + day.distractedMs
          const rate = total ? day.focusedMs / total : null
          return (
            <div key={day.key} tabIndex={0} aria-label={`${day.longLabel}: ${formatDuration(day.focusedMs)} focused`} className="group relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end rounded-md outline-none hover:bg-[var(--glass-track)] focus-visible:bg-[var(--glass-track)]">
              <div className="mx-auto flex w-full max-w-[34px] flex-col-reverse gap-[2px]" style={{ height: `${(total / scale) * 100}%` }}>
                {segments.map((segment, segmentIndex) => (
                  <div
                    key={segmentIndex}
                    style={{ flexGrow: segment.ms, flexBasis: 0, background: segment.color, minHeight: 2 }}
                    className={segmentIndex === segments.length - 1 ? 'rounded-t-[4px]' : ''}
                  />
                ))}
              </div>
              {!total && !day.isFuture && <div className="mx-auto mb-0 h-[2px] w-full max-w-[34px] rounded-full bg-border" />}
              <HoverTip align={index < 2 ? 'left' : index > days.length - 3 ? 'right' : 'center'}>
                <div className="mb-1 font-semibold text-foreground">{day.longLabel}</div>
                {total ? (
                  <>
                    <TipRow color={DEEP} label="Deep work" value={formatDuration(day.deepWorkMs)} />
                    <TipRow color={FOCUS} label="Other focus" value={formatDuration(otherFocus)} />
                    <TipRow color={DISTRACT} label="Distracted" value={formatDuration(day.distractedMs)} />
                    <TipRow label="Focus rate" value={percent(rate)} />
                  </>
                ) : (
                  <div className="text-muted-foreground">{day.isFuture ? 'Still ahead' : 'Nothing tracked'}</div>
                )}
              </HoverTip>
            </div>
          )
        })}
      </div>
      <div className="mt-1.5 flex gap-[3px] pl-9">
        {days.map((day, index) => (
          <div key={day.key} className={`min-w-0 flex-1 truncate text-center text-[10px] tabular-nums ${day.isToday ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
            {!dense || index % 2 === 0 || day.isToday ? day.label : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Weekday × hour of focused time. Only the hours that saw any activity are
 * drawn, so a 9-to-6 person gets wide cells instead of a mostly empty grid.
 */
export function FocusHeatmap({
  focusedMs,
  distractedMs,
  weekdayDays,
  golden,
}: {
  focusedMs: number[][]
  distractedMs: number[][]
  weekdayDays: number[]
  golden: { startHour: number; endHour: number } | null
}) {
  const { firstHour, lastHour, max } = useMemo(() => {
    let first = 24
    let last = -1
    let peak = 0
    for (let weekday = 0; weekday < 7; weekday += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const value = focusedMs[weekday][hour] / Math.max(1, weekdayDays[weekday])
        if (focusedMs[weekday][hour] + distractedMs[weekday][hour] > 0) {
          first = Math.min(first, hour)
          last = Math.max(last, hour)
        }
        peak = Math.max(peak, value)
      }
    }
    if (last < 0) return { firstHour: 8, lastHour: 19, max: 0 }
    // Keep at least an eight-hour frame so a single active hour does not stretch.
    while (last - first < 7) {
      if (first > 0) first -= 1
      if (last - first < 7 && last < 23) last += 1
    }
    return { firstHour: first, lastHour: last, max: peak }
  }, [focusedMs, distractedMs, weekdayDays])
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => firstHour + index)
  const step = hours.length > 14 ? 3 : 2

  return (
    <div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `30px repeat(${hours.length}, minmax(0, 1fr))` }}>
        {WEEKDAYS.map((weekday, weekdayIndex) => (
          <div key={weekday} className="contents">
            <div className="flex items-center text-[10px] text-muted-foreground">{weekday}</div>
            {hours.map((hour, hourIndex) => {
              const days = Math.max(1, weekdayDays[weekdayIndex])
              const focus = focusedMs[weekdayIndex][hour] / days
              const distract = distractedMs[weekdayIndex][hour] / days
              const intensity = max ? focus / max : 0
              const inGolden = !!golden && hour >= golden.startHour && hour < golden.endHour
              return (
                <div
                  key={hour}
                  tabIndex={0}
                  aria-label={`${weekday} ${formatHour(hour)}: ${formatDuration(focus)} focused`}
                  className="group relative h-6 rounded-[5px] outline-none ring-foreground/40 hover:ring-1 focus-visible:ring-1"
                  style={{
                    background: focus > 0 ? `color-mix(in srgb, ${FOCUS} ${Math.round(18 + intensity * 82)}%, transparent)` : 'var(--glass-track)',
                    boxShadow: inGolden && focus > 0 ? 'inset 0 0 0 1px var(--glass-rim)' : undefined,
                  }}
                >
                  {distract > focus && distract >= 5 * 60_000 && <i className="absolute right-[3px] top-[3px] size-[5px] rounded-full" style={{ background: DISTRACT }} />}
                  <HoverTip align={hourIndex < 3 ? 'left' : hourIndex > hours.length - 4 ? 'right' : 'center'}>
                    <div className="mb-1 font-semibold text-foreground">
                      {weekday} {formatHour(hour)}–{formatHour(hour + 1)}
                    </div>
                    {focus + distract > 0 ? (
                      <>
                        <TipRow color={FOCUS} label={weekdayDays[weekdayIndex] > 1 ? 'Focused (avg)' : 'Focused'} value={formatDuration(focus)} />
                        <TipRow color={DISTRACT} label={weekdayDays[weekdayIndex] > 1 ? 'Distracted (avg)' : 'Distracted'} value={formatDuration(distract)} />
                      </>
                    ) : (
                      <div className="text-muted-foreground">Nothing tracked</div>
                    )}
                  </HoverTip>
                </div>
              )
            })}
          </div>
        ))}
        <div />
        {hours.map((hour, index) => (
          <div key={hour} className="pt-1 text-[10px] tabular-nums text-muted-foreground">
            {index % step === 0 ? String(hour).padStart(2, '0') : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Count of focus blocks by length, with the bucket holding the median marked. */
export function StaminaHistogram({ buckets, medianMs }: { buckets: Array<{ label: string; minMs: number; maxMs: number | null; count: number; focusedMs: number }>; medianMs: number | null }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count))
  return (
    <div className="flex h-36 items-end gap-2">
      {buckets.map((bucket, index) => {
        const holdsMedian = medianMs !== null && medianMs >= bucket.minMs && (bucket.maxMs === null || medianMs < bucket.maxMs)
        const deep = bucket.minMs >= 25 * 60_000
        return (
          <div key={bucket.label} tabIndex={0} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end outline-none">
            <div className="mb-1 text-center text-[11px] font-medium tabular-nums text-foreground">{bucket.count || ''}</div>
            <div
              className="mx-auto w-full max-w-[44px] rounded-t-[4px]"
              style={{
                height: `${Math.max(bucket.count ? 4 : 0, (bucket.count / max) * 75)}%`,
                background: deep ? DEEP : FOCUS,
                opacity: holdsMedian || medianMs === null ? 1 : 0.55,
              }}
            />
            <div className={`mt-1.5 truncate text-center text-[10px] ${holdsMedian ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{bucket.label}</div>
            <HoverTip align={index === 0 ? 'left' : index === buckets.length - 1 ? 'right' : 'center'}>
              <div className="mb-1 font-semibold text-foreground">Blocks of {bucket.label}</div>
              <TipRow label="Blocks" value={String(bucket.count)} />
              <TipRow label="Focused time" value={formatDuration(bucket.focusedMs)} />
            </HoverTip>
          </div>
        )
      })}
    </div>
  )
}

/** A labelled horizontal meter used by the ranked lists. */
export function Meter({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="tempo-insight-bar-track h-1.5 w-full overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%`, background: color }} />
    </div>
  )
}

/** A thin ring for a single ratio, e.g. completed sessions. */
export function Ring({ value, size = 56, color = FOCUS, children }: { value: number | null; size?: number; color?: string; children?: ReactNode }) {
  const radius = (size - 6) / 2
  const circumference = 2 * Math.PI * radius
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--glass-track)" strokeWidth={5} />
        {value !== null && (
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeDasharray={`${circumference * Math.min(1, Math.max(0, value))} ${circumference}`} />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[12px] font-semibold tabular-nums">{children}</div>
    </div>
  )
}

/** One titled card on the Analysis page. */
export function InsightSection({ icon, title, subtitle, children, className = '', aside }: { icon: ReactNode; title: string; subtitle?: string; children: ReactNode; className?: string; aside?: ReactNode }) {
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
