import { ChevronDown, Clock3, Focus } from 'lucide-react'
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
import { TimelineChapterIcon } from './TimelineChapterIcon'
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

const percent = (value: number, total: number) => (total > 0 ? `${(value / total) * 100}%` : '0%')

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

function FocusGoalDetail({
  focusGoal,
  compact = false
}: {
  focusGoal: TimelineFocusGoal
  compact?: boolean
}) {
  const ratio = focusGoal.focusRatio === null ? null : Math.round(focusGoal.focusRatio * 100)
  return (
    <div className={cn('tempo-timeline-focus-detail', compact && 'is-compact')}>
      <div className="flex items-center justify-between gap-3">
        <span className="tempo-timeline-focus-label">
          <Focus size={12} aria-hidden="true" />
          {focusPhaseLabel(focusGoal)}
        </span>
        <span className={cn('tempo-timeline-focus-adherence', `is-${focusGoal.adherence}`)}>
          {focusGoal.adherenceLabel}
        </span>
      </div>
      <p className="mt-1 truncate text-xs font-medium text-foreground">{focusGoal.goal}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {ratio === null
          ? `${formatDuration(focusGoal.observedMs)} tracked in this block`
          : `${ratio}% focused across classified activity in this block`}
      </p>
      {!compact && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            <span className="tempo-timeline-state-dot is-focused" aria-hidden="true" /> Focused{' '}
            <span className="tabular-nums">{formatDuration(focusGoal.focusedMs)}</span>
          </span>
          <span>
            <span className="tempo-timeline-state-dot is-distracted" aria-hidden="true" />{' '}
            Distracted{' '}
            <span className="tabular-nums">{formatDuration(focusGoal.distractedMs)}</span>
          </span>
          {focusGoal.uncertainMs > 0 && (
            <span>
              <span className="tempo-timeline-state-dot is-uncertain" aria-hidden="true" />{' '}
              Uncertain{' '}
              <span className="tabular-nums">{formatDuration(focusGoal.uncertainMs)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function ChapterActivityDetail({
  chapter,
  compact = false,
  selectedSessionId,
  onSelectSession
}: {
  chapter: TimelineChapter
  compact?: boolean
  selectedSessionId?: string | null
  onSelectSession?: (session: ActivitySessionBlock) => void
}) {
  const apps = summarizeTimelineChapterApps(chapter)
  const visibleApps = apps.slice(0, compact ? 3 : 4)
  const remainingApps = apps.length - visibleApps.length

  return (
    <div className={cn(compact ? 'space-y-2' : 'tempo-timeline-detail-card')}>
      {!compact && (
        <p className="mb-2 text-[11px] text-muted-foreground">
          {chapter.boundaryReason || 'Tracked activity'}. {timeLabel(chapter.startTime)}–
          {timeLabel(chapter.endTime)} · {formatDuration(+chapter.endTime - +chapter.startTime)}{' '}
          elapsed, {formatDuration(chapter.focusedMs + chapter.distractedMs + chapter.uncertainMs)}{' '}
          tracked.
        </p>
      )}
      {compact && (
        <>
          {chapter.focusGoal && <FocusGoalDetail focusGoal={chapter.focusGoal} compact={compact} />}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Apps used
            </span>
            <span className="text-[11px] text-muted-foreground">
              {apps.length} {apps.length === 1 ? 'app' : 'apps'}
            </span>
          </div>
          <ul className="space-y-1" aria-label="Applications used in this activity block">
            {visibleApps.map((app) => (
              <li key={app.appName} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-foreground">{app.appName}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatDuration(app.durationMs)}
                </span>
              </li>
            ))}
            {remainingApps > 0 && (
              <li className="text-[11px] text-muted-foreground">
                +{remainingApps} more {remainingApps === 1 ? 'app' : 'apps'}
              </li>
            )}
          </ul>
        </>
      )}
      {!compact && (
        <div className="tempo-timeline-sequence">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">Activity in order</p>
          <ol aria-label="Activities in chronological order">
            {chapter.sessions.map((session, index) => (
              <li key={`${session.id}:${index}`}>
                <button
                  type="button"
                  className={cn(
                    'tempo-timeline-step',
                    selectedSessionId === session.id && 'is-selected'
                  )}
                  onClick={() => onSelectSession?.(session)}
                  aria-label={`${timeLabel(session.startTime)} to ${timeLabel(session.endTime)}. ${session.label}. ${session.ownerName}. ${formatDuration(session.activeDurationMs)} ${session.isProductive === true ? 'focused' : session.isProductive === false ? 'distracted' : 'uncertain'}.`}
                >
                  <time dateTime={session.startTime.toISOString()}>
                    {timeLabel(session.startTime)}
                  </time>
                  <span className="min-w-0">
                    <span className="tempo-timeline-step-title">{session.label}</span>
                    <span className="tempo-timeline-step-meta">
                      {session.ownerName} · {timeLabel(session.startTime)}–
                      {timeLabel(session.endTime)}
                    </span>
                  </span>
                  <span className="tempo-timeline-step-state">
                    <span
                      className={cn(
                        'tempo-timeline-state-dot',
                        session.isProductive === true
                          ? 'is-focused'
                          : session.isProductive === false
                            ? 'is-distracted'
                            : 'is-uncertain'
                      )}
                      aria-hidden="true"
                    />
                    {formatDuration(session.activeDurationMs)}
                    <span className="tempo-timeline-step-meta">
                      {session.isProductive === true
                        ? 'Focused'
                        : session.isProductive === false
                          ? 'Distracted'
                          : 'Uncertain'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
        {stateDetails(chapter).map((state) => (
          <span key={state.label} className="inline-flex items-center gap-1.5">
            <span className={cn('tempo-timeline-state-dot', state.className)} aria-hidden="true" />
            {state.label} <span className="tabular-nums">{formatDuration(state.durationMs)}</span>
          </span>
        ))}
      </div>
    </div>
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
  const totals = displayedChapters.reduce(
    (total, chapter) => ({
      focused: total.focused + chapter.focusedMs,
      distracted: total.distracted + chapter.distractedMs,
      uncertain: total.uncertain + chapter.uncertainMs
    }),
    { focused: 0, distracted: 0, uncertain: 0 }
  )
  if (!displayedChapters.length) {
    return <div className="tempo-day-empty-state">No tracked activity for this day.</div>
  }

  return (
    <TooltipProvider delayDuration={350}>
      <div className="tempo-day-timeline">
        <div className="tempo-timeline-overview">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">Your day in order</h3>
            <span className="text-[11px] text-muted-foreground">
              {displayedChapters.length} activity blocks ·{' '}
              {formatDuration(totals.focused + totals.distracted + totals.uncertain)} tracked
            </span>
          </div>
          <div
            className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
            aria-label="Timeline totals"
          >
            <span>
              <span className="tempo-timeline-state-dot is-focused" aria-hidden="true" />{' '}
              {formatDuration(totals.focused)} focused
            </span>
            <span>
              <span className="tempo-timeline-state-dot is-distracted" aria-hidden="true" />{' '}
              {formatDuration(totals.distracted)} distracted
            </span>
            {totals.uncertain > 0 && (
              <span>
                <span className="tempo-timeline-state-dot is-uncertain" aria-hidden="true" />{' '}
                {formatDuration(totals.uncertain)} uncertain
              </span>
            )}
          </div>
          <details className="tempo-timeline-grouping">
            <summary>How blocks are grouped</summary>
            <p>
              Recorded focus goals stay together across app switches and consecutive focus sessions.
              Outside a focus session, blocks follow an activity; quick visits under 2 minutes are
              grouped or kept with the activity you return to. Brief transitions between sessions
              stay with a neighboring block. Distracting or uncertain stretches of 2 minutes or more
              stand alone during focus. A gap of 5 minutes starts a new block. Durations show
              tracked time, excluding gaps.
            </p>
          </details>
        </div>
        <div role="list" aria-label="Activity timeline">
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
            const detail =
              apps
                .slice(0, 3)
                .map((app) => `${app.appName} ${formatDuration(app.durationMs)}`)
                .join(' · ') + (apps.length > 3 ? ` · +${apps.length - 3} more` : '')
            const title = focusGoal?.goal || chapter.label
            const state = dominantState(chapter)
            const expanded = expandedChapterId === chapter.id

            return (
              <div key={chapter.id} role="listitem">
                {gap >= TIMELINE_GAP_MS && (
                  <div className="tempo-timeline-gap">
                    <span aria-hidden="true" />
                    <div>
                      <Clock3 size={12} /> {formatDuration(gap)} without tracked activity
                    </div>
                  </div>
                )}
                <div className="tempo-timeline-item">
                  <time className="tempo-timeline-time" dateTime={chapter.startTime.toISOString()}>
                    {timeLabel(chapter.startTime)}
                  </time>
                  <span className={cn('tempo-timeline-axis', `is-${state}`)} aria-hidden="true">
                    <span />
                  </span>
                  <div className="tempo-timeline-content">
                    <Tooltip open={expanded ? false : undefined}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedChapterId((current) =>
                              current === chapter.id ? null : chapter.id
                            )
                            onSelectSession(primary)
                          }}
                          className={cn(
                            'tempo-timeline-row',
                            selected ? 'is-selected' : '',
                            related && !selected ? 'is-related' : ''
                          )}
                          aria-expanded={expanded}
                          aria-controls={`timeline-chapter-${chapter.id}`}
                          aria-label={`${timeLabel(chapter.startTime)}–${timeLabel(chapter.endTime)}. ${focusGoal ? `Focus goal ${focusGoal.goal}. ${focusGoal.adherenceLabel}.` : chapter.label}, ${formatDuration(durationMs)}. ${formatDuration(chapter.focusedMs)} focused, ${formatDuration(chapter.distractedMs)} distracted${chapter.uncertainMs ? `, ${formatDuration(chapter.uncertainMs)} uncertain` : ''}. ${expanded ? 'Hide' : 'Show'} activity details.`}
                        >
                          <div className="tempo-timeline-row-content">
                            <TimelineChapterIcon
                              chapter={focusGoal ? { ...chapter, label: title } : chapter}
                              size={19}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="tempo-timeline-row-heading">
                                <span className="tempo-timeline-block-kind">
                                  {focusGoal
                                    ? focusPhaseLabel(focusGoal)
                                    : chapter.label === 'Short activities'
                                      ? 'Quick switches'
                                      : state === 'focused'
                                        ? 'Activity'
                                        : state === 'distracted'
                                          ? 'Distraction'
                                          : 'Uncertain activity'}
                                </span>
                                {focusGoal && (
                                  <span
                                    className={cn(
                                      'tempo-timeline-focus-adherence',
                                      `is-${focusGoal.adherence}`
                                    )}
                                  >
                                    {focusGoal.adherenceLabel}
                                  </span>
                                )}
                              </div>
                              <span className="tempo-timeline-block-title">{title}</span>
                              <p className="tempo-timeline-app-summary">{detail}</p>
                              <p className="tempo-timeline-mix">
                                {stateDetails(chapter)
                                  .map(
                                    (item) =>
                                      `${formatDuration(item.durationMs)} ${item.label.toLowerCase()}`
                                  )
                                  .join(' · ')}
                              </p>
                            </div>
                            <div className="tempo-timeline-duration">
                              <span>{formatDuration(durationMs)}</span>
                              <span>tracked</span>
                              <span>
                                {timeLabel(chapter.startTime)}–{timeLabel(chapter.endTime)}
                              </span>
                            </div>
                            <ChevronDown
                              className={cn(
                                'tempo-timeline-disclosure',
                                expanded ? 'is-expanded' : ''
                              )}
                              size={14}
                              aria-hidden="true"
                            />
                          </div>
                          <div
                            className="tempo-timeline-rail"
                            aria-label={`${formatDuration(chapter.focusedMs)} focused, ${formatDuration(chapter.distractedMs)} distracted, ${formatDuration(chapter.uncertainMs)} uncertain`}
                          >
                            {chapter.focusedMs > 0 && (
                              <span
                                className="is-focused"
                                style={{ width: percent(chapter.focusedMs, durationMs) }}
                              />
                            )}
                            {chapter.distractedMs > 0 && (
                              <span
                                className="is-distracted"
                                style={{ width: percent(chapter.distractedMs, durationMs) }}
                              />
                            )}
                            {chapter.uncertainMs > 0 && (
                              <span
                                className="is-uncertain"
                                style={{ width: percent(chapter.uncertainMs, durationMs) }}
                              />
                            )}
                          </div>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" align="start" className="w-64 p-3">
                        <p className="mb-2 text-xs font-medium text-foreground">{title}</p>
                        <ChapterActivityDetail chapter={chapter} compact />
                      </TooltipContent>
                    </Tooltip>
                    {expanded && (
                      <section
                        id={`timeline-chapter-${chapter.id}`}
                        className="tempo-timeline-detail"
                        aria-label={`${title} activity details`}
                      >
                        <ChapterActivityDetail
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
      </div>
    </TooltipProvider>
  )
}
