import { Clock3 } from 'lucide-react'
import type { ActivitySessionBlock, TimelineChapter } from '../lib/activitySessions'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import { cn } from '../lib/utils'
import { ActivityIcon } from './ui/ActivityIcon'

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

const blockHeight = (durationMs: number) =>
  Math.min(190, Math.max(44, Math.round(durationMs / (40 * 1000))))

const percent = (value: number, total: number) => total > 0 ? `${(value / total) * 100}%` : '0%'

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
    return <div className="p-8 text-center text-sm text-muted-foreground">No tracked activity for this day.</div>
  }

  return (
    <div className="px-3 pb-4 pt-2">
      {displayedChapters.map((chapter, index) => {
        const previous = displayedChapters[index - 1]
        const gap = previous ? chapter.startTime.getTime() - previous.endTime.getTime() : 0
        const primary = chapter.sessions[0]
        const durationMs = chapter.focusedMs + chapter.distractedMs + chapter.uncertainMs
        const selected = chapter.sessions.some((session) => selectedSessionId === session.id)
        const related = chapter.sessions.some((session) => selectedActivityKey === session.displayKey)
        const height = blockHeight(durationMs)

        return (
          <div key={chapter.id}>
            {gap >= longGapMs && (
              <div className="ml-14 flex h-8 items-center gap-2 border-l border-dashed border-border pl-3 text-[11px] text-muted-foreground">
                <Clock3 size={12} /> {formatDuration(gap)} without tracked activity
              </div>
            )}
            <div className="grid grid-cols-[42px_minmax(0,1fr)] gap-2">
              <div className="pt-2 text-right text-[11px] font-medium text-muted-foreground">
                {timeLabel(chapter.startTime)}
              </div>
              <button
                type="button"
                onClick={() => onSelectSession(primary)}
                className={cn(
                  'relative w-full overflow-hidden rounded-lg border px-3 pb-4 pt-2 text-left transition-all',
                  selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:brightness-95',
                  related && !selected ? 'ring-1 ring-primary/50' : ''
                )}
                style={{
                  minHeight: `${height}px`,
                  backgroundColor: chapter.focusedMs >= chapter.distractedMs ? '#22c55e1f' : '#ef44441f',
                  borderColor: chapter.focusedMs >= chapter.distractedMs ? '#22c55e66' : '#ef444466'
                }}
              >
                <div className="flex min-w-0 items-center gap-2 pr-16">
                  <ActivityIcon url={primary.url} appName={primary.ownerName} size={16} />
                  <span className="truncate text-sm font-semibold">{chapter.label}</span>
                </div>
                <span className="absolute right-3 top-2 text-xs font-medium text-muted-foreground">
                  {formatDuration(durationMs)}
                </span>
                {height >= 72 && (chapter.summary || chapter.sessions.length > 1) && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{chapter.summary || `${chapter.sessions.length} activities · ${formatDuration(chapter.focusedMs)} focused · ${formatDuration(chapter.distractedMs)} distracted`}</p>
                )}
                {height >= 100 && (
                  <p className="absolute bottom-2 right-3 text-[11px] text-muted-foreground">
                    {timeLabel(chapter.startTime)}–{timeLabel(chapter.endTime)}
                  </p>
                )}
                <div
                  className="absolute inset-x-3 bottom-2 flex h-1.5 overflow-hidden rounded-full bg-muted/70"
                  aria-label={`${formatDuration(chapter.focusedMs)} focused, ${formatDuration(chapter.distractedMs)} distracted, ${formatDuration(chapter.uncertainMs)} uncertain`}
                  title={`${formatDuration(chapter.focusedMs)} focused · ${formatDuration(chapter.distractedMs)} distracted${chapter.uncertainMs ? ` · ${formatDuration(chapter.uncertainMs)} uncertain` : ''}`}
                >
                  {chapter.focusedMs > 0 && <span className="bg-emerald-500" style={{ width: percent(chapter.focusedMs, durationMs) }} />}
                  {chapter.distractedMs > 0 && <span className="bg-rose-500" style={{ width: percent(chapter.distractedMs, durationMs) }} />}
                  {chapter.uncertainMs > 0 && <span className="bg-amber-500" style={{ width: percent(chapter.uncertainMs, durationMs) }} />}
                </div>
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
