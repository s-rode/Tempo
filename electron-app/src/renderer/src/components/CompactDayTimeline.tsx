import { ChevronDown, CircleHelp, Focus } from 'lucide-react'
import { useState } from 'react'
import {
  buildTimelineChapters,
  TIMELINE_GAP_MS,
  summarizeTimelineChapterApps,
  type ActivitySessionBlock,
  type TimelineChapter,
  type TimelineFocusGoal
} from '../lib/activitySessions'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import { cn } from '../lib/utils'
import { sessionState, type DayOverviewState } from '../lib/dayOverview'
import { NativeAppIcon, TimelineChapterIcon } from './TimelineChapterIcon'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

interface CompactDayTimelineProps {
  sessions: ActivitySessionBlock[]
  chapters?: TimelineChapter[]
  selectedSessionId: string | null
  selectedActivityKey: string | null
  onSelectSession: (session: ActivitySessionBlock) => void
}

const timeLabel = (value: Date) =>
  value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

const dominantState = (chapter: TimelineChapter) => {
  if (chapter.uncertainMs > chapter.focusedMs && chapter.uncertainMs > chapter.distractedMs)
    return 'uncertain'
  if (chapter.distractedMs > chapter.focusedMs) return 'distracted'
  return 'focused'
}

const stateDetails = (chapter: TimelineChapter) =>
  [
    { label: 'Focused', durationMs: chapter.focusedMs, className: 'is-focused' },
    { label: 'Distracted', durationMs: chapter.distractedMs, className: 'is-distracted' },
    { label: 'Uncertain', durationMs: chapter.uncertainMs, className: 'is-uncertain' }
  ].filter((state) => state.durationMs > 0)

const focusPhaseLabel = (goal: TimelineFocusGoal) =>
  goal.kind === 'pomodoro'
    ? `Pomodoro work ${Math.floor(goal.phaseIndex / 2) + 1}`
    : goal.runIds && goal.runIds.length > 1
      ? `${goal.runIds.length} focus sessions`
      : 'Focus session'

const STATE_LABEL: Record<DayOverviewState, string> = {
  focused: 'Focused',
  distracted: 'Distracted',
  uncertain: 'Uncertain'
}

const blockKind = (chapter: TimelineChapter, state: DayOverviewState) =>
  chapter.focusGoal
    ? focusPhaseLabel(chapter.focusGoal)
    : chapter.label === 'Short activities'
      ? 'Quick switches'
      : state === 'focused'
        ? 'Activity'
        : state === 'distracted'
          ? 'Distraction'
          : 'Uncertain activity'

/** The block's activity in the order it happened, as runs of one state. */
const sequenceRuns = (chapter: TimelineChapter) => {
  const runs: Array<{ state: DayOverviewState; durationMs: number }> = []
  for (const session of [...chapter.sessions].sort((a, b) => +a.startTime - +b.startTime)) {
    const state = sessionState(session)
    const last = runs[runs.length - 1]
    if (last?.state === state) last.durationMs += session.activeDurationMs
    else runs.push({ state, durationMs: session.activeDurationMs })
  }
  return runs.filter((run) => run.durationMs > 0)
}

function StateTotals({ chapter }: { chapter: TimelineChapter }) {
  return (
    <div className="tempo-block-totals">
      {stateDetails(chapter).map((state) => (
        <span key={state.label}>
          <span className={cn('tempo-day-dot', state.className)} aria-hidden="true" />
          {state.label} <span className="tabular-nums">{formatDuration(state.durationMs)}</span>
        </span>
      ))}
    </div>
  )
}

/** Hover summary: the apps behind a block, without opening it. */
function BlockPeek({ chapter, title }: { chapter: TimelineChapter; title: string }) {
  const apps = summarizeTimelineChapterApps(chapter)
  const visibleApps = apps.slice(0, 4)
  const longest = visibleApps[0]?.durationMs || 1
  return (
    <div className="tempo-block-peek">
      <p className="truncate text-xs font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
        {timeLabel(chapter.startTime)}–{timeLabel(chapter.endTime)}
        {chapter.focusGoal ? ` · ${chapter.focusGoal.adherenceLabel}` : ''}
      </p>
      <ul aria-label="Applications used in this block">
        {visibleApps.map((app) => (
          <li key={app.appName}>
            <NativeAppIcon appName={app.appName} size={16} />
            <span className="min-w-0 flex-1 truncate">{app.appName}</span>
            <span className="tempo-block-peek-bar" aria-hidden="true">
              <span style={{ width: `${(app.durationMs / longest) * 100}%` }} />
            </span>
            <time>{formatDuration(app.durationMs)}</time>
          </li>
        ))}
      </ul>
      {apps.length > visibleApps.length && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          +{apps.length - visibleApps.length} more
        </p>
      )}
      <StateTotals chapter={chapter} />
    </div>
  )
}

function BlockDetail({
  chapter,
  selectedSessionId,
  onSelectSession
}: {
  chapter: TimelineChapter
  selectedSessionId: string | null
  onSelectSession: (session: ActivitySessionBlock) => void
}) {
  const focusGoal = chapter.focusGoal
  const ratio =
    focusGoal && focusGoal.focusRatio !== null ? Math.round(focusGoal.focusRatio * 100) : null
  return (
    <>
      <p className="tempo-block-detail-note">
        {chapter.boundaryReason || 'Tracked activity'}.{' '}
        {formatDuration(+chapter.endTime - +chapter.startTime)} elapsed,{' '}
        {formatDuration(chapter.focusedMs + chapter.distractedMs + chapter.uncertainMs)} tracked
        {ratio === null ? '' : `, ${ratio}% of it focused`}.
      </p>
      <ol className="tempo-block-steps" aria-label="Activities in chronological order">
        {chapter.sessions.map((session, index) => {
          const state = sessionState(session)
          return (
            <li key={`${session.id}:${index}`}>
              <button
                type="button"
                className={cn(
                  'tempo-block-step',
                  selectedSessionId === session.id && 'is-selected'
                )}
                onClick={() => onSelectSession(session)}
                aria-label={`${timeLabel(session.startTime)} to ${timeLabel(session.endTime)}. ${session.label}. ${session.ownerName}. ${formatDuration(session.activeDurationMs)} ${state}.`}
              >
                <time dateTime={session.startTime.toISOString()}>
                  {timeLabel(session.startTime)}
                </time>
                <span className={cn('tempo-day-dot', `is-${state}`)} title={STATE_LABEL[state]} />
                <span className="min-w-0">
                  <span className="tempo-block-step-title">{session.label}</span>
                  <span className="tempo-block-step-meta">{session.ownerName}</span>
                </span>
                <span className="tempo-block-step-duration">
                  {formatDuration(session.activeDurationMs)}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <StateTotals chapter={chapter} />
    </>
  )
}

export default function CompactDayTimeline({
  sessions,
  chapters,
  selectedSessionId,
  selectedActivityKey,
  onSelectSession
}: CompactDayTimelineProps) {
  const [expandedChapterId, setExpandedChapterId] = useState<string | null>(null)
  const displayedChapters = chapters || buildTimelineChapters(sessions)
  if (!displayedChapters.length) {
    return <div className="tempo-day-empty-state">No tracked activity for this day.</div>
  }

  return (
    <TooltipProvider delayDuration={450}>
      <section className="tempo-blocks" aria-labelledby="tempo-blocks-heading">
        <div className="tempo-blocks-heading">
          <h3 id="tempo-blocks-heading">Your day in order</h3>
          <span>
            {displayedChapters.length} {displayedChapters.length === 1 ? 'block' : 'blocks'}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label="How blocks are grouped">
                <CircleHelp size={13} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="w-72 p-3">
              <p className="text-xs leading-[1.5] text-muted-foreground">
                Recorded focus goals stay together across app switches and consecutive focus
                sessions. Outside a focus session, blocks follow an activity; quick visits under 2
                minutes are grouped or kept with the activity you return to. Distracting or
                uncertain stretches of 2 minutes or more stand alone during focus. A gap of 5
                minutes starts a new block. Durations show tracked time, excluding gaps.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div role="list" aria-label="Activity timeline" className="tempo-blocks-list">
          {displayedChapters.map((chapter, index) => {
            const previous = displayedChapters[index - 1]
            const gap = previous ? chapter.startTime.getTime() - previous.endTime.getTime() : 0
            const primary = chapter.sessions[0]
            const durationMs = chapter.focusedMs + chapter.distractedMs + chapter.uncertainMs
            const selected = chapter.sessions.some((session) => selectedSessionId === session.id)
            const related = chapter.sessions.some(
              (session) => selectedActivityKey === session.displayKey
            )
            const focusGoal = chapter.focusGoal
            const apps = summarizeTimelineChapterApps(chapter)
            const title = focusGoal?.goal || chapter.label
            const appNames =
              apps
                .slice(0, 3)
                .map((app) => app.appName)
                .join(', ') + (apps.length > 3 ? ` +${apps.length - 3}` : '')
            // Outside a focus session the title often names the app already,
            // so the second line says what was actually open there.
            const subjects = focusGoal
              ? []
              : [
                  ...new Set(
                    chapter.sessions.map((session) =>
                      // A distraction's label only names the app; its window
                      // title says what it was.
                      (session.isProductive === false ? session.title : session.label)?.trim()
                    )
                  )
                ].filter(
                  (label): label is string =>
                    !!label && label !== title && !apps.some((app) => app.appName === label)
                )
            const detail = subjects.length
              ? subjects.slice(0, 2).join(', ') +
                (subjects.length > 2 ? ` +${subjects.length - 2}` : '')
              : appNames
            const state = dominantState(chapter)
            const expanded = expandedChapterId === chapter.id
            const offTaskMs = state === 'focused' ? chapter.distractedMs : 0
            const runs = sequenceRuns(chapter)

            return (
              <div key={chapter.id} role="listitem">
                {gap >= TIMELINE_GAP_MS && (
                  <div className="tempo-block-gap">
                    <span>{formatDuration(gap)} without tracked activity</span>
                  </div>
                )}
                <div className="tempo-block-line">
                  <time className="tempo-block-time" dateTime={chapter.startTime.toISOString()}>
                    {timeLabel(chapter.startTime)}
                  </time>
                  <div
                    className={cn(
                      'tempo-block',
                      `is-${state}`,
                      runs.length > 1 && 'has-sequence',
                      selected && 'is-selected',
                      related && !selected && 'is-related',
                      expanded && 'is-expanded'
                    )}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="tempo-block-button"
                          onClick={() => {
                            setExpandedChapterId((current) =>
                              current === chapter.id ? null : chapter.id
                            )
                            onSelectSession(primary)
                          }}
                          aria-expanded={expanded}
                          aria-controls={`timeline-chapter-${chapter.id}`}
                          aria-label={`${timeLabel(chapter.startTime)}–${timeLabel(chapter.endTime)}. ${focusGoal ? `Focus goal ${focusGoal.goal}. ${focusGoal.adherenceLabel}.` : chapter.label}, ${formatDuration(durationMs)}. ${formatDuration(chapter.focusedMs)} focused, ${formatDuration(chapter.distractedMs)} distracted${chapter.uncertainMs ? `, ${formatDuration(chapter.uncertainMs)} uncertain` : ''}. ${expanded ? 'Hide' : 'Show'} activity details.`}
                        >
                          <span className="tempo-block-accent" aria-hidden="true" />
                          <TimelineChapterIcon
                            chapter={focusGoal ? { ...chapter, label: title } : chapter}
                            size={26}
                          />
                          <span className="tempo-block-main">
                            <span className="tempo-block-title-row">
                              <span className="tempo-block-title">{title}</span>
                              {focusGoal && (
                                <span
                                  className={cn('tempo-block-chip', `is-${focusGoal.adherence}`)}
                                >
                                  {focusGoal.adherenceLabel}
                                </span>
                              )}
                            </span>
                            <span className="tempo-block-meta">
                              {focusGoal && <Focus size={11} aria-hidden="true" />}
                              {blockKind(chapter, state)} · {detail}
                              {offTaskMs > 0 && (
                                <span className="tempo-block-offtask">
                                  {' '}
                                  · {formatDuration(offTaskMs)} distracted
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="tempo-block-duration">
                            <strong>{formatDuration(durationMs)}</strong>
                            <span>
                              {timeLabel(chapter.startTime)}–{timeLabel(chapter.endTime)}
                            </span>
                          </span>
                          <ChevronDown
                            className="tempo-block-disclosure"
                            size={14}
                            aria-hidden="true"
                          />
                          {runs.length > 1 && (
                            <span className="tempo-block-sequence" aria-hidden="true">
                              {runs.map((run, runIndex) => (
                                <span
                                  key={runIndex}
                                  className={`is-${run.state}`}
                                  style={{ flexGrow: run.durationMs }}
                                />
                              ))}
                            </span>
                          )}
                        </button>
                      </TooltipTrigger>
                      {!expanded && (
                        <TooltipContent side="left" align="start" className="w-64 p-3">
                          <BlockPeek chapter={chapter} title={title} />
                        </TooltipContent>
                      )}
                    </Tooltip>
                    {expanded && (
                      <section
                        id={`timeline-chapter-${chapter.id}`}
                        className="tempo-block-detail"
                        aria-label={`${title} activity details`}
                      >
                        <BlockDetail
                          chapter={chapter}
                          selectedSessionId={selectedSessionId}
                          onSelectSession={onSelectSession}
                        />
                      </section>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </TooltipProvider>
  )
}
