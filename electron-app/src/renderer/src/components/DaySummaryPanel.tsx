import { ChevronDown, ChevronRight, Clock3, Focus, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Category } from 'shared'
import { useAuth } from '../contexts/AuthContext'
import {
  ActivitySessionBlock,
  buildDayActivitySummaries,
  sessionTotals
} from '../lib/activitySessions'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import { cn } from '../lib/utils'
import { trpc } from '../utils/trpc'
import AppIcon from './AppIcon'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'

interface DaySummaryPanelProps {
  sessions: ActivitySessionBlock[]
  categories: Category[]
  selectedSessionId: string | null
  selectedActivityKey: string | null
  onSelectSession: (session: ActivitySessionBlock) => void
  refetchEvents: () => void
}

const timeRange = (session: ActivitySessionBlock) =>
  `${session.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${session.endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`

export default function DaySummaryPanel({
  sessions,
  categories,
  selectedSessionId,
  selectedActivityKey,
  onSelectSession,
  refetchEvents
}: DaySummaryPanelProps) {
  const { token } = useAuth()
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [showAllActivities, setShowAllActivities] = useState(false)
  const totals = useMemo(() => sessionTotals(sessions), [sessions])
  const summaries = useMemo(() => buildDayActivitySummaries(sessions), [sessions])
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || null
  const categoryTotals = useMemo(() => {
    const values = new Map<string, { category: Category | undefined; durationMs: number }>()
    for (const session of sessions) {
      const value = values.get(session.categoryId) || {
        category: categories.find((category) => category._id === session.categoryId),
        durationMs: 0
      }
      value.durationMs += session.activeDurationMs
      values.set(session.categoryId, value)
    }
    return [...values.values()].sort((left, right) => right.durationMs - left.durationMs)
  }, [categories, sessions])

  const recategorize = trpc.activeWindowEvents.recategorizeBlock.useMutation({
    onSuccess: () => refetchEvents()
  })

  const moveSelectedSession = (categoryId: string) => {
    if (!token || !selectedSession || categoryId === selectedSession.categoryId) return
    recategorize.mutate({
      token,
      eventIds: selectedSession.eventIds,
      newCategoryId: categoryId,
      rememberExactMatch: true
    })
  }

  const maxCategoryDuration = categoryTotals[0]?.durationMs || 1

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-2xl font-semibold">{formatDuration(totals.focusedMs)}</p>
              <p className="text-xs text-muted-foreground">focused</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{formatDuration(totals.distractedMs)}</p>
              <p className="text-xs text-muted-foreground">distracted</p>
            </div>
          </div>
          {totals.uncertainMs > 0 && (
            <p className="text-xs text-muted-foreground">{formatDuration(totals.uncertainMs)} uncertain</p>
          )}
          <div className="space-y-2 border-t pt-3">
            {categoryTotals.map(({ category, durationMs }) => (
              <div key={category?._id || 'uncategorized'}>
                <div className="mb-1 flex justify-between gap-2 text-xs">
                  <span className="truncate">{category?.name || 'Uncertain'}</span>
                  <span>{formatDuration(durationMs)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      backgroundColor: category?.color || '#808080',
                      width: `${(durationMs / maxCategoryDuration) * 100}%`
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-2">
          <p className="px-2 pb-2 pt-1 text-sm font-semibold">Activities</p>
          <div className="space-y-1">
            {(showAllActivities ? summaries : summaries.slice(0, 6)).map((summary) => {
              const expanded = expandedKeys.has(summary.displayKey)
              const isSelected = selectedActivityKey === summary.displayKey
              const firstSession = summary.sessions[0]
              return (
                <div key={summary.displayKey} className="rounded-md">
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedKeys((current) => {
                        const next = new Set(current)
                        if (next.has(summary.displayKey)) next.delete(summary.displayKey)
                        else next.add(summary.displayKey)
                        return next
                      })
                      onSelectSession(firstSession)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted',
                      isSelected ? 'bg-muted' : ''
                    )}
                  >
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <AppIcon appName={summary.ownerName} size={16} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-sm">{summary.label}</span>
                    {summary.sessions.length > 1 && (
                      <span className="text-[11px] text-muted-foreground">{summary.sessions.length} visits</span>
                    )}
                    <span className="text-xs font-medium">{formatDuration(summary.totalDurationMs)}</span>
                  </button>
                  {expanded && (
                    <div className="ml-7 space-y-1 border-l border-border py-1 pl-2">
                      {summary.sessions.map((session) => (
                        <button
                          type="button"
                          key={session.id}
                          onClick={() => onSelectSession(session)}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted',
                            selectedSessionId === session.id ? 'bg-muted' : ''
                          )}
                        >
                          <span>{timeRange(session)}</span>
                          <span>{formatDuration(session.activeDurationMs)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {summaries.length > 6 && <Button variant="ghost" className="w-full text-xs" onClick={() => setShowAllActivities((value) => !value)}>{showAllActivities ? 'Show fewer activities' : `Show all ${summaries.length} activities`}</Button>}
          </div>
        </CardContent>
      </Card>

      {selectedSession && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start gap-2">
              {selectedSession.isProductive ? <Focus size={18} /> : <TriangleAlert size={18} />}
              <div className="min-w-0">
                <p className="font-semibold">{selectedSession.label}</p>
                <p className="text-xs text-muted-foreground">{timeRange(selectedSession)} · {formatDuration(selectedSession.activeDurationMs)}</p>
              </div>
            </div>
            {selectedSession.summary && <p className="text-sm text-muted-foreground">{selectedSession.summary}</p>}
            {(selectedSession.title || selectedSession.url) && (
              <p className="truncate text-xs text-muted-foreground">{selectedSession.url || selectedSession.title}</p>
            )}
            {selectedSession.reasoning && <p className="text-xs"><strong>Why this category:</strong> {selectedSession.reasoning}</p>}
            {selectedSession.classificationStatus?.startsWith('manual') && (
              <p className="text-xs text-muted-foreground">Manually corrected</p>
            )}
            {selectedSession.briefActivities.length > 0 && (
              <div className="border-t pt-2 text-xs text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">Brief activity folded into this session</p>
                {selectedSession.briefActivities.map((activity, index) => (
                  <p key={`${activity.label}-${index}`}>{activity.label} · {formatDuration(activity.durationMs)}</p>
                ))}
              </div>
            )}
            <div className="border-t pt-2">
              <p className="mb-2 text-xs font-medium">Move this session</p>
              <div className="flex flex-wrap gap-1">
                {categories.filter((category) => category._id !== selectedSession.categoryId).map((category) => (
                  <Button
                    key={category._id}
                    size="xs"
                    variant="outline"
                    disabled={recategorize.isLoading}
                    onClick={() => moveSelectedSession(category._id)}
                    style={{ borderColor: category.color }}
                  >
                    {category.name}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
