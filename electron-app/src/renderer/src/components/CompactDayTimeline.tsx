import { Clock3 } from 'lucide-react'
import type { ActivitySessionBlock, TimelineChapter } from '../lib/activitySessions'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import { cn } from '../lib/utils'
import { TimelineChapterIcon } from './TimelineChapterIcon'

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

export default function CompactDayTimeline({
  sessions,
  chapters,
  selectedSessionId,
  selectedActivityKey,
  onSelectSession
}: CompactDayTimelineProps) {
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
              <button
                type="button"
                onClick={() => onSelectSession(primary)}
                className={cn(
                  'tempo-timeline-row',
                  selected ? 'is-selected' : '',
                  related && !selected ? 'is-related' : ''
                )}
                aria-label={`${chapter.label}, ${formatDuration(durationMs)}. ${formatDuration(chapter.focusedMs)} focused, ${formatDuration(chapter.distractedMs)} distracted${chapter.uncertainMs ? `, ${formatDuration(chapter.uncertainMs)} uncertain` : ''}`}
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
                </div>
                <div
                  className="tempo-timeline-rail"
                  aria-label={`${formatDuration(chapter.focusedMs)} focused, ${formatDuration(chapter.distractedMs)} distracted, ${formatDuration(chapter.uncertainMs)} uncertain`}
                  title={`${formatDuration(chapter.focusedMs)} focused · ${formatDuration(chapter.distractedMs)} distracted${chapter.uncertainMs ? ` · ${formatDuration(chapter.uncertainMs)} uncertain` : ''}`}
                >
                  {chapter.focusedMs > 0 && <span className="is-focused" style={{ width: percent(chapter.focusedMs, durationMs) }} />}
                  {chapter.distractedMs > 0 && <span className="is-distracted" style={{ width: percent(chapter.distractedMs, durationMs) }} />}
                  {chapter.uncertainMs > 0 && <span className="is-uncertain" style={{ width: percent(chapter.uncertainMs, durationMs) }} />}
                </div>
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
