import { ChevronDown, Clock3 } from 'lucide-react'
import { useState } from 'react'
import { summarizeTimelineChapterApps, type ActivitySessionBlock, type TimelineChapter } from '../lib/activitySessions'
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

const longGapMs = 30 * 60 * 1000

const timeLabel = (value: Date) =>
  value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const percent = (value: number, total: number) => total > 0 ? `${(value / total) * 100}%` : '0%'

const dominantState = (chapter: TimelineChapter) => {
  if (chapter.uncertainMs > chapter.focusedMs && chapter.uncertainMs > chapter.distractedMs) return 'uncertain'
  if (chapter.distractedMs > chapter.focusedMs) return 'distracted'
  return 'focused'
}

const stateDetails = (chapter: TimelineChapter) => [
  { label: 'Focused', durationMs: chapter.focusedMs, className: 'is-focused' },
  { label: 'Distracted', durationMs: chapter.distractedMs, className: 'is-distracted' },
  { label: 'Uncertain', durationMs: chapter.uncertainMs, className: 'is-uncertain' }
].filter((state) => state.durationMs > 0)

function ChapterActivityDetail({ chapter, compact = false }: { chapter: TimelineChapter; compact?: boolean }) {
  const apps = summarizeTimelineChapterApps(chapter)
  const visibleApps = apps.slice(0, compact ? 3 : 4)
  const remainingApps = apps.length - visibleApps.length

  return (
    <div className={cn(compact ? 'space-y-2' : 'tempo-timeline-detail-card')}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Apps used</span>
        <span className="text-[11px] text-muted-foreground">{apps.length} {apps.length === 1 ? 'app' : 'apps'}</span>
      </div>
      <ul className="space-y-1" aria-label="Applications used in this activity block">
        {visibleApps.map((app) => (
          <li key={app.appName} className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-foreground">{app.appName}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatDuration(app.durationMs)}</span>
          </li>
        ))}
        {remainingApps > 0 && <li className="text-[11px] text-muted-foreground">+{remainingApps} more {remainingApps === 1 ? 'app' : 'apps'}</li>}
      </ul>
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
  const displayedChapters = chapters || sessions.map((session) => ({
    id: session.id, startTime: session.startTime, endTime: session.endTime, sessions: [session],
    focusedMs: session.isProductive ? session.activeDurationMs : 0,
    distractedMs: session.isProductive === false ? session.activeDurationMs : 0,
    uncertainMs: session.isProductive === undefined ? session.activeDurationMs : 0,
    label: session.label, summary: session.summary
  }))
  if (!displayedChapters.length) {
    return <div className="tempo-day-empty-state">No tracked activity for this day.</div>
  }

  return (
    <TooltipProvider delayDuration={350}>
      <div className="tempo-day-timeline" role="list" aria-label="Activity timeline">
      {displayedChapters.map((chapter, index) => {
        const previous = displayedChapters[index - 1]
        const gap = previous ? chapter.startTime.getTime() - previous.endTime.getTime() : 0
        const primary = chapter.sessions[0]
        const durationMs = chapter.focusedMs + chapter.distractedMs + chapter.uncertainMs
        const selected = chapter.sessions.some((session) => selectedSessionId === session.id)
        const related = chapter.sessions.some((session) => selectedActivityKey === session.displayKey)
        const isMixed = [chapter.focusedMs, chapter.distractedMs, chapter.uncertainMs].filter((duration) => duration > 0).length > 1
        const detail = chapter.summary || (chapter.sessions.length > 1 ? `${chapter.sessions.length} activities` : timeLabel(chapter.endTime))
        const state = dominantState(chapter)
        const expanded = expandedChapterId === chapter.id

        return (
          <div key={chapter.id} role="listitem">
            {gap >= longGapMs && (
              <div className="tempo-timeline-gap">
                <span aria-hidden="true" />
                <div><Clock3 size={12} /> {formatDuration(gap)} without tracked activity</div>
              </div>
            )}
            <div className="tempo-timeline-item">
              <time className="tempo-timeline-time" dateTime={chapter.startTime.toISOString()}>
                {timeLabel(chapter.startTime)}
              </time>
              <span className={cn('tempo-timeline-axis', `is-${state}`)} aria-hidden="true"><span /></span>
              <div className="tempo-timeline-content">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedChapterId((current) => current === chapter.id ? null : chapter.id)
                        onSelectSession(primary)
                      }}
                      className={cn(
                        'tempo-timeline-row',
                        selected ? 'is-selected' : '',
                        related && !selected ? 'is-related' : ''
                      )}
                      aria-expanded={expanded}
                      aria-controls={`timeline-chapter-${chapter.id}`}
                      aria-label={`${chapter.label}, ${formatDuration(durationMs)}. ${formatDuration(chapter.focusedMs)} focused, ${formatDuration(chapter.distractedMs)} distracted${chapter.uncertainMs ? `, ${formatDuration(chapter.uncertainMs)} uncertain` : ''}. ${expanded ? 'Hide' : 'Show'} app details.`}
                    >
                      <div className="tempo-timeline-row-content">
                        <TimelineChapterIcon chapter={chapter} size={19} />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate font-medium">{chapter.label}</span>
                            {isMixed && <span className="shrink-0 text-[11px] text-muted-foreground">Mixed activity</span>}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{detail}</p>
                        </div>
                        <div className="tempo-timeline-duration">
                          <span>{formatDuration(durationMs)}</span>
                          <span>{timeLabel(chapter.startTime)}–{timeLabel(chapter.endTime)}</span>
                        </div>
                        <ChevronDown className={cn('tempo-timeline-disclosure', expanded ? 'is-expanded' : '')} size={14} aria-hidden="true" />
                      </div>
                      <div
                        className="tempo-timeline-rail"
                        aria-label={`${formatDuration(chapter.focusedMs)} focused, ${formatDuration(chapter.distractedMs)} distracted, ${formatDuration(chapter.uncertainMs)} uncertain`}
                      >
                        {chapter.focusedMs > 0 && <span className="is-focused" style={{ width: percent(chapter.focusedMs, durationMs) }} />}
                        {chapter.distractedMs > 0 && <span className="is-distracted" style={{ width: percent(chapter.distractedMs, durationMs) }} />}
                        {chapter.uncertainMs > 0 && <span className="is-uncertain" style={{ width: percent(chapter.uncertainMs, durationMs) }} />}
                      </div>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left" align="start" className="w-64 p-3">
                    <p className="mb-2 text-xs font-medium text-foreground">{chapter.label}</p>
                    <ChapterActivityDetail chapter={chapter} compact />
                  </TooltipContent>
                </Tooltip>
                {expanded && <section id={`timeline-chapter-${chapter.id}`} className="tempo-timeline-detail" aria-label={`${chapter.label} app details`}><ChapterActivityDetail chapter={chapter} /></section>}
              </div>
            </div>
          </div>
        )
      })}
      </div>
    </TooltipProvider>
  )
}
