import type { inferRouterOutputs } from '@trpc/server'
import { ArrowDownRight, ArrowUpRight, Flag, Mountain, PartyPopper, Target, TrendingUp } from 'lucide-react'
import { goalColorVar } from '../../lib/plannerModel'
import type { AppRouter } from '../../utils/trpc'
import { BEHIND, FOCUS, InsightSection, percent } from './InsightCharts'
import '../../styles/planner.css'

type Insights = inferRouterOutputs<AppRouter>['analytics']['getInsights']
export type GoalsAnalysis = NonNullable<Insights['goals']>
type GoalRow = GoalsAnalysis['goals'][number]
type Suggestion = GoalsAnalysis['suggestions'][number]

const MINUTE = 60_000
/** "45 min", "3h", "7h 20m": the same wording as the goal suggestions. */
const minutesText = (ms: number) => {
  const minutes = Math.round(ms / MINUTE)
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return rest ? `${Math.floor(minutes / 60)}h ${rest}m` : `${Math.floor(minutes / 60)}h`
}

function GoalDot({ goal, size = 8 }: { goal: Pick<GoalRow, 'color' | 'icon'>; size?: number }) {
  return <i className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: goalColorVar(goal.color) }} aria-hidden />
}

/** How the period's session time split between goals, as one quiet bar. */
function ShareBar({ analysis }: { analysis: GoalsAnalysis }) {
  const total = analysis.totalWorkMs
  const parts = analysis.goals.filter((goal) => goal.workMs > 0)
  if (!total) return null
  return (
    <div>
      <div className="tempo-insight-bar-track flex h-2 w-full gap-px overflow-hidden" role="img" aria-label="Session time by goal">
        {parts.map((goal) => (
          <div key={goal.id} className="h-full first:rounded-l-full" style={{ width: `${(goal.workMs / total) * 100}%`, background: goalColorVar(goal.color) }} title={`${goal.title}: ${minutesText(goal.workMs)}`} />
        ))}
        {analysis.unlinkedMs >= MINUTE && <div className="h-full flex-1 bg-muted-foreground/25" title={`No goal: ${minutesText(analysis.unlinkedMs)}`} />}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-muted-foreground">
        {parts.map((goal) => (
          <span key={goal.id} className="inline-flex items-center gap-1.5">
            <GoalDot goal={goal} size={7} />
            {goal.title}
            <span className="tabular-nums text-foreground">{percent(goal.workMs / total)}</span>
          </span>
        ))}
        {analysis.unlinkedMs >= MINUTE && (
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block size-[7px] rounded-full bg-muted-foreground/25" aria-hidden />
            No goal
            <span className="tabular-nums text-foreground">{percent(analysis.unlinkedMs / total)}</span>
          </span>
        )}
      </div>
    </div>
  )
}

/** Progress toward the target with a tick where the pace says you should be by now. */
function TargetMeter({ goal, max }: { goal: GoalRow; max: number }) {
  const scale = goal.targetMs ?? max
  const fill = scale ? Math.min(1, goal.workMs / scale) : 0
  const pace = goal.targetMs && goal.expectedByNowMs !== null && goal.expectedByNowMs < goal.targetMs ? goal.expectedByNowMs / goal.targetMs : null
  return (
    <div className="relative">
      <div className="tempo-insight-bar-track h-1.5 w-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${goal.workMs ? Math.max(2, fill * 100) : 0}%`, background: goalColorVar(goal.color) }} />
      </div>
      {pace !== null && pace > 0 && (
        <span
          className="absolute -top-[3px] h-3 w-[2px] -translate-x-1/2 rounded-full bg-foreground/45"
          style={{ left: `${pace * 100}%` }}
          title={`Where the pace says you would be by today: ${minutesText(goal.expectedByNowMs || 0)}`}
          aria-hidden
        />
      )}
    </div>
  )
}

function Status({ goal, inProgress, daysLeft }: { goal: GoalRow; inProgress: boolean; daysLeft: number }) {
  const left = goal.targetMs !== null ? Math.max(0, goal.targetMs - goal.workMs) : 0
  switch (goal.status) {
    case 'reached':
      return <span style={{ color: FOCUS }}>Target reached</span>
    case 'on_pace':
      return (
        <span>
          <span style={{ color: FOCUS }}>On pace</span>
          {left >= MINUTE && <> · {minutesText(left)} to go{inProgress && daysLeft ? `, ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}</>}
        </span>
      )
    case 'behind':
      return (
        <span>
          <span style={{ color: BEHIND }}>{inProgress ? `${minutesText(Math.max(MINUTE, (goal.expectedByNowMs || 0) - goal.workMs))} behind pace` : `${minutesText(left)} short`}</span>
          {inProgress && left >= MINUTE && <> · {minutesText(left)} to go</>}
        </span>
      )
    case 'untouched':
      return <span>No time yet</span>
    default:
      return <span>No target</span>
  }
}

function Trend({ goal, comparisonLabel }: { goal: GoalRow; comparisonLabel: string }) {
  if (!goal.previousWorkMs && !goal.workMs) return null
  if (!goal.previousWorkMs) return <span>none {comparisonLabel}</span>
  const diff = goal.workMs - goal.previousWorkMs
  if (Math.abs(diff) < 5 * MINUTE) return <span>same as {comparisonLabel}</span>
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span>
      <Icon size={11} className="mr-0.5 inline align-[-1px]" aria-hidden />
      {minutesText(Math.abs(diff))} {diff > 0 ? 'more' : 'less'} than {comparisonLabel}
    </span>
  )
}

const suggestionIcon = (suggestion: Suggestion) => {
  if (suggestion.kind === 'momentum') return <PartyPopper size={16} />
  if (suggestion.id.startsWith('goal-behind') || suggestion.id.startsWith('goal-short')) return <Flag size={16} />
  if (suggestion.id.startsWith('goal-slipping')) return <TrendingUp size={16} className="rotate-90" />
  return <Target size={16} />
}

/**
 * Long-term goal accountability: where session time went, how each goal
 * stands against its weekly target and what to do about the gaps.
 */
export function GoalProgress({
  analysis,
  periodWord,
  comparisonLabel,
  inProgress,
  daysLeft,
  onOpenPlan
}: {
  analysis: GoalsAnalysis
  periodWord: string
  comparisonLabel: string
  inProgress: boolean
  daysLeft: number
  onOpenPlan?: () => void
}) {
  const goals = analysis.goals
  const active = goals.filter((goal) => !goal.achieved)
  const maxWork = Math.max(0, ...goals.map((goal) => goal.workMs))
  const withTarget = active.filter((goal) => goal.targetMs !== null)
  const planLink = onOpenPlan && (
    <button type="button" onClick={onOpenPlan} className="text-[11px] font-medium text-muted-foreground hover:text-foreground">
      Open Plan
    </button>
  )

  if (!goals.length)
    return (
      <InsightSection icon={<Mountain size={16} />} title="Long-term goals" aside={planLink}>
        <p className="text-sm text-muted-foreground">
          Name a goal in Plan and link tasks to it. Session time on those tasks shows up here, measured against the hours you want to give each goal.
        </p>
      </InsightSection>
    )

  const summary = (() => {
    if (!analysis.totalWorkMs) return `No focus session ran this ${periodWord} yet, so no time went into your goals.`
    const linked = `${minutesText(analysis.linkedMs)} of your ${minutesText(analysis.totalWorkMs)} in sessions went into your goals (${percent(analysis.linkedMs / analysis.totalWorkMs)}).`
    if (!withTarget.length) return `${linked} Give a goal a weekly target in Plan to see whether you are on pace.`
    const behind = withTarget.filter((goal) => goal.status === 'behind').length
    const fine = withTarget.length - behind
    return `${linked} ${fine} of ${withTarget.length} goal${withTarget.length === 1 ? '' : 's'} with a target ${fine === 1 ? 'is' : 'are'} on pace${behind ? `, ${behind} behind` : ''}.`
  })()

  return (
    <InsightSection
      icon={<Mountain size={16} />}
      title="Long-term goals"
      subtitle="Session time on tasks linked to each goal, against the time you set out to give it."
      aside={planLink}
    >
      <div className="space-y-5">
        <ShareBar analysis={analysis} />
        <ul className="grid gap-x-8 gap-y-4 md:grid-cols-2">
          {goals.map((goal) => (
            <li key={goal.id} className={goal.achieved ? 'opacity-70' : undefined}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="inline-flex min-w-0 items-center gap-2">
                  {goal.icon ? <span className="text-[13px] leading-none" aria-hidden>{goal.icon}</span> : <GoalDot goal={goal} />}
                  <span className="truncate text-[13px] font-medium" title={goal.title}>{goal.title}</span>
                  {goal.achieved && <span className="shrink-0 text-[10px] text-muted-foreground">Achieved</span>}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  <span className="font-medium text-foreground">{minutesText(goal.workMs)}</span>
                  {goal.targetMs !== null && <> of {minutesText(goal.targetMs)}</>}
                  {goal.share !== null && goal.workMs > 0 && <> · {percent(goal.share)}</>}
                </span>
              </div>
              <div className="mt-1.5">
                <TargetMeter goal={goal} max={maxWork} />
              </div>
              <div className="mt-1 text-[10.5px] text-muted-foreground">
                {[
                  !goal.achieved && <Status key="status" goal={goal} inProgress={inProgress} daysLeft={daysLeft} />,
                  goal.sessions > 0 && (
                    <span key="sessions">
                      {goal.sessions} session{goal.sessions === 1 ? '' : 's'}
                      {goal.focusRate !== null && <>, {percent(goal.focusRate)} focused</>}
                    </span>
                  ),
                  (goal.workMs > 0 || goal.previousWorkMs > 0) && <Trend key="trend" goal={goal} comparisonLabel={comparisonLabel} />
                ]
                  .filter(Boolean)
                  .map((part, index) => (
                    <span key={index}>
                      {index > 0 && ' · '}
                      {part}
                    </span>
                  ))}
              </div>
            </li>
          ))}
        </ul>
        {analysis.suggestions.length > 0 && (
          <div className="grid gap-2.5 md:grid-cols-3">
            {analysis.suggestions.map((suggestion) => (
              <article key={suggestion.id} className="tempo-insight-suggestion p-4">
                <div className="mb-2 inline-flex size-7 items-center justify-center rounded-lg bg-[var(--glass-track)] text-foreground">{suggestionIcon(suggestion)}</div>
                <h3 className="text-[13px] font-semibold leading-snug">{suggestion.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{suggestion.body}</p>
              </article>
            ))}
          </div>
        )}
        <p className="rounded-[10px] bg-[var(--glass-track)] px-3 py-2 text-xs leading-relaxed text-muted-foreground">{summary}</p>
      </div>
    </InsightSection>
  )
}
