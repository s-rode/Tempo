import { ClassificationReview } from './ClassificationReview'
import { Clock3, Focus, MousePointerClick, TriangleAlert } from 'lucide-react'
import { type ReactElement, useMemo, useState } from 'react'
import { Category } from 'shared'
import { useAuth } from '../contexts/AuthContext'
import {
  ActivitySessionBlock,
  DayActivitySummary,
  buildDayActivitySummaries,
  sessionTotals
} from '../lib/activitySessions'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import { cn } from '../lib/utils'
import { trpc } from '../utils/trpc'
import { NativeAppIcon } from './TimelineChapterIcon'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'

interface DaySummaryPanelProps {
  dayRange: { startDateMs: number; endDateMs: number }
  sessions: ActivitySessionBlock[]
  categories: Category[]
  selectedSessionId: string | null
  selectedActivityKey: string | null
  onSelectSession: (session: ActivitySessionBlock) => void
  refetchEvents: () => void
}

const timeRange = (session: Pick<ActivitySessionBlock, 'startTime' | 'endTime'>): string =>
  `${session.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${session.endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`

const sourceRepresentative = (source: DayActivitySummary): ActivitySessionBlock =>
  [...source.sessions].sort((left, right) => right.endTime.getTime() - left.endTime.getTime())[0]

const sourceActivities = (
  source: DayActivitySummary
): Array<{ label: string; durationMs: number }> => {
  const activities = new Map<string, number>()
  for (const session of source.sessions) {
    const label = session.label || source.ownerName
    activities.set(label, (activities.get(label) || 0) + session.activeDurationMs)
  }
  return [...activities.entries()]
    .map(([label, durationMs]) => ({ label, durationMs }))
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 3)
}

const STATE_ROWS = [
  { label: 'Focused', key: 'focusedMs', state: 'is-focused' },
  { label: 'Distracted', key: 'distractedMs', state: 'is-distracted' },
  { label: 'Uncertain', key: 'uncertainMs', state: 'is-uncertain' }
] as const

type StateMix = Pick<DayActivitySummary, 'focusedMs' | 'distractedMs' | 'uncertainMs'>

function ActivityStateRail(mix: StateMix): ReactElement {
  const segments = STATE_ROWS.filter((row) => mix[row.key] > 0)
  return (
    <div
      className="tempo-state-rail"
      role="img"
      aria-label={
        segments.map((row) => `${row.label} ${formatDuration(mix[row.key])}`).join(', ') ||
        'No classified time'
      }
    >
      {segments.map((row) => (
        <span key={row.state} className={row.state} style={{ flexGrow: mix[row.key] }} />
      ))}
    </div>
  )
}

function StateBreakdown({ source }: { source: DayActivitySummary }): ReactElement {
  return (
    <div className="tempo-detail-breakdown" aria-label="Classification breakdown">
      {STATE_ROWS.filter((row) => source[row.key] > 0).map((row) => (
        <span key={row.label}>
          <span className={cn('tempo-day-dot', row.state)} aria-hidden="true" />
          {row.label} <time>{formatDuration(source[row.key])}</time>
        </span>
      ))}
    </div>
  )
}

export default function DaySummaryPanel({
  dayRange,
  sessions,
  categories,
  selectedSessionId,
  selectedActivityKey,
  onSelectSession,
  refetchEvents
}: DaySummaryPanelProps): ReactElement {
  const { token } = useAuth()
  const [showAllActivities, setShowAllActivities] = useState(false)
  const totals = useMemo(() => sessionTotals(sessions), [sessions])
  const summaries = useMemo(() => buildDayActivitySummaries(sessions), [sessions])
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || null
  const selectedSource = useMemo(
    () =>
      summaries.find(
        (source) =>
          source.sessionIds.includes(selectedSessionId || '') ||
          source.sessions.some((session) => session.displayKey === selectedActivityKey)
      ) || null,
    [selectedActivityKey, selectedSessionId, summaries]
  )
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
    onSuccess: (): void => refetchEvents()
  })

  const moveSelectedSession = (categoryId: string): void => {
    if (!token || !selectedSession || categoryId === selectedSession.categoryId) return
    recategorize.mutate({
      token,
      eventIds: selectedSession.eventIds,
      newCategoryId: categoryId,
      correctionActionId: crypto.randomUUID(),
      rememberExactMatch: true
    })
  }

  const maxCategoryDuration = categoryTotals[0]?.durationMs || 1
  const visibleSources = showAllActivities ? summaries : summaries.slice(0, 6)
  const sessionForInspector =
    selectedSession && selectedSource?.sessionIds.includes(selectedSession.id)
      ? selectedSession
      : selectedSource
        ? sourceRepresentative(selectedSource)
        : null
  const currentCategory = sessionForInspector
    ? categories.find((category) => category._id === sessionForInspector.categoryId)
    : undefined
  const contextCopy =
    sessionForInspector?.summary ||
    (sessionForInspector?.isProductive === false
      ? 'This activity did not provide evidence of advancing the current goal.'
      : undefined)

  const inspectedState =
    sessionForInspector?.isProductive === true
      ? { className: 'is-focused', label: 'Focused', Icon: Focus }
      : sessionForInspector?.isProductive === false
        ? { className: 'is-distracted', label: 'Distracted', Icon: TriangleAlert }
        : { className: 'is-uncertain', label: 'Uncertain', Icon: Clock3 }

  return (
    <>
      {categoryTotals.length > 0 && (
        <section
          className="tempo-glass-card tempo-inspector-card"
          aria-labelledby="day-categories-heading"
        >
          <div className="tempo-inspector-card-heading">
            <h3 id="day-categories-heading">Categories</h3>
            <span>
              {formatDuration(totals.focusedMs + totals.distractedMs + totals.uncertainMs)}
            </span>
          </div>
          {categoryTotals.map(({ category, durationMs }) => (
            <div key={category?._id || 'uncategorized'} className="tempo-category-row">
              <div>
                <i style={{ backgroundColor: category?.color || '#d97706' }} aria-hidden="true" />
                <span className="truncate">{category?.name || 'Uncertain'}</span>
                <time>{formatDuration(durationMs)}</time>
              </div>
              <div className="tempo-category-bar">
                <span
                  style={{
                    backgroundColor: category?.color || '#d97706',
                    width: `${(durationMs / maxCategoryDuration) * 100}%`
                  }}
                />
              </div>
            </div>
          ))}
        </section>
      )}

      <section
        className="tempo-glass-card tempo-inspector-card"
        aria-labelledby="activity-sources-heading"
      >
        <div className="tempo-inspector-card-heading">
          <h3 id="activity-sources-heading">Activities</h3>
          {summaries.length > 0 && (
            <span>
              {summaries.length} {summaries.length === 1 ? 'app' : 'apps'}
            </span>
          )}
        </div>
        {visibleSources.length > 0 ? (
          <div className="tempo-app-list" role="list">
            {visibleSources.map((source) => {
              const isSelected = source === selectedSource
              return (
                <button
                  type="button"
                  key={source.displayKey}
                  role="listitem"
                  aria-pressed={isSelected}
                  onClick={() => onSelectSession(sourceRepresentative(source))}
                  className={cn('tempo-app-row', isSelected && 'is-selected')}
                >
                  <NativeAppIcon appName={source.ownerName} size={22} />
                  <span className="min-w-0 flex-1">
                    <span className="tempo-app-name">{source.label}</span>
                    <span className="tempo-app-subtitle">{timeRange(source)}</span>
                  </span>
                  <span className="tempo-app-duration">
                    <time>{formatDuration(source.totalDurationMs)}</time>
                    <ActivityStateRail {...source} />
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No tracked activity yet.</p>
        )}
        {summaries.length > 6 && (
          <button
            type="button"
            className="tempo-inspector-more"
            onClick={() => setShowAllActivities((value) => !value)}
          >
            {showAllActivities ? 'Show fewer' : `Show ${summaries.length - 6} more`}
          </button>
        )}
      </section>

      <section
        className="tempo-glass-card tempo-inspector-card"
        aria-label="Selected activity details"
      >
        {selectedSource && sessionForInspector ? (
          <>
            <div className="tempo-detail-heading">
              <NativeAppIcon appName={selectedSource.ownerName} size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">{selectedSource.label}</p>
                <p className="truncate text-[11px] tabular-nums text-muted-foreground">
                  {timeRange(selectedSource)} ·{' '}
                  {selectedSource.sessions.length === 1
                    ? '1 activity'
                    : `${selectedSource.sessions.length} activities`}
                </p>
              </div>
              <time className="text-[13px] font-semibold tabular-nums">
                {formatDuration(selectedSource.totalDurationMs)}
              </time>
            </div>

            <div className="mt-3">
              <ActivityStateRail {...selectedSource} />
              <StateBreakdown source={selectedSource} />
            </div>

            <div className="tempo-detail-section">
              <p className="tempo-detail-label">Most of this time</p>
              {sourceActivities(selectedSource).map((activity) => (
                <div key={activity.label} className="tempo-detail-row">
                  <span className="min-w-0 truncate">{activity.label}</span>
                  <time>{formatDuration(activity.durationMs)}</time>
                </div>
              ))}
            </div>

            <div className="tempo-detail-section">
              <p className="tempo-detail-label">Selected activity</p>
              <p className="text-[13px] font-medium leading-5">{sessionForInspector.label}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn('tempo-detail-state', inspectedState.className)}>
                  <inspectedState.Icon size={11} aria-hidden="true" />
                  {inspectedState.label}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {timeRange(sessionForInspector)} ·{' '}
                  {formatDuration(sessionForInspector.activeDurationMs)}
                </span>
              </div>
              {contextCopy && (
                <p className="mt-2 text-xs leading-[1.45] text-muted-foreground">{contextCopy}</p>
              )}
              {sessionForInspector.classificationStatus?.startsWith('manual') && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">Manually corrected</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="xs" disabled={recategorize.isLoading}>
                      {recategorize.isLoading ? 'Updating…' : 'Change Category…'}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>
                      Current: {currentCategory?.name || 'Uncertain'}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {categories.map((category) => (
                      <DropdownMenuItem
                        key={category._id}
                        disabled={
                          category._id === sessionForInspector.categoryId || recategorize.isLoading
                        }
                        onSelect={() => moveSelectedSession(category._id)}
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: category.color }}
                        />
                        {category.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <span className="text-[11px] text-muted-foreground">
                  Only this activity changes.
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="tempo-activity-inspector-empty">
            <MousePointerClick size={17} aria-hidden="true" />
            <div>
              <p className="font-medium text-foreground">Activity details</p>
              <p>Select an app or a block to see its time and classification mix.</p>
            </div>
          </div>
        )}
      </section>

      <ClassificationReview
        startDateMs={dayRange.startDateMs}
        endDateMs={dayRange.endDateMs}
        onChange={refetchEvents}
      />
    </>
  )
}
