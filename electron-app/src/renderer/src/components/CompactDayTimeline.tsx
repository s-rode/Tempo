import { Clock3 } from 'lucide-react'
import type { ActivitySessionBlock } from '../lib/activitySessions'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import { cn } from '../lib/utils'
import { ActivityIcon } from './ui/ActivityIcon'

interface CompactDayTimelineProps {
  sessions: ActivitySessionBlock[]
  selectedSessionId: string | null
  selectedActivityKey: string | null
  onSelectSession: (session: ActivitySessionBlock) => void
}

const longGapMs = 30 * 60 * 1000

const timeLabel = (value: Date) =>
  value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const blockHeight = (durationMs: number) =>
  Math.min(190, Math.max(44, Math.round(durationMs / (40 * 1000))))

export default function CompactDayTimeline({
  sessions,
  selectedSessionId,
  selectedActivityKey,
  onSelectSession
}: CompactDayTimelineProps) {
  if (!sessions.length) {
    return <div className="p-8 text-center text-sm text-muted-foreground">No tracked activity for this day.</div>
  }

  return (
    <div className="px-3 pb-4 pt-2">
      {sessions.map((session, index) => {
        const previous = sessions[index - 1]
        const gap = previous ? session.startTime.getTime() - previous.endTime.getTime() : 0
        const selected = selectedSessionId === session.id
        const related = selectedActivityKey === session.displayKey
        const height = blockHeight(session.activeDurationMs)

        return (
          <div key={session.id}>
            {gap >= longGapMs && (
              <div className="ml-14 flex h-8 items-center gap-2 border-l border-dashed border-border pl-3 text-[11px] text-muted-foreground">
                <Clock3 size={12} /> {formatDuration(gap)} without tracked activity
              </div>
            )}
            <div className="grid grid-cols-[42px_minmax(0,1fr)] gap-2">
              <div className="pt-2 text-right text-[11px] font-medium text-muted-foreground">
                {timeLabel(session.startTime)}
              </div>
              <button
                type="button"
                onClick={() => onSelectSession(session)}
                className={cn(
                  'relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left transition-all',
                  selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:brightness-95',
                  related && !selected ? 'ring-1 ring-primary/50' : ''
                )}
                style={{
                  minHeight: `${height}px`,
                  backgroundColor: `${session.categoryColor || '#808080'}26`,
                  borderColor: `${session.categoryColor || '#808080'}66`
                }}
              >
                <div className="flex min-w-0 items-center gap-2 pr-16">
                  <ActivityIcon url={session.url} appName={session.ownerName} size={16} />
                  <span className="truncate text-sm font-semibold">{session.label}</span>
                </div>
                <span className="absolute right-3 top-2 text-xs font-medium text-muted-foreground">
                  {formatDuration(session.activeDurationMs)}
                </span>
                {height >= 72 && session.summary && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{session.summary}</p>
                )}
                {height >= 100 && (
                  <p className="absolute bottom-2 right-3 text-[11px] text-muted-foreground">
                    {timeLabel(session.startTime)}–{timeLabel(session.endTime)}
                  </p>
                )}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
