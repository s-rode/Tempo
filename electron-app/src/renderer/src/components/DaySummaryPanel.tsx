import { ClassificationReview } from './ClassificationReview'
import { Clock3, Focus, TriangleAlert } from 'lucide-react'
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

function ActivityStateRail({
  focusedMs,
  distractedMs,
  uncertainMs
}: Pick<DayActivitySummary, 'focusedMs' | 'distractedMs' | 'uncertainMs'>): ReactElement {
  const totalMs = focusedMs + distractedMs + uncertainMs
  if (!totalMs) return <div className="tempo-activity-state-rail is-empty" aria-hidden="true" />

  const segments = [
    { label: 'Focused', value: focusedMs, state: 'is-focused' },
    { label: 'Distracted', value: distractedMs, state: 'is-distracted' },
    { label: 'Uncertain', value: uncertainMs, state: 'is-uncertain' }
  ].filter((segment) => segment.value > 0)

  return (
    <div
      className="tempo-activity-state-rail"
      aria-label={segments
        .map((segment) => `${segment.label} ${formatDuration(segment.value)}`)
        .join(', ')}
    >
      {segments.map((segment) => (
        <span
          key={segment.state}
          className={segment.state}
          style={{ width: `${(segment.value / totalMs) * 100}%` }}
        />
      ))}
    </div>
  )
}

function StateBreakdown({ source }: { source: DayActivitySummary }): ReactElement {
  const states = [
    { label: 'Focused', value: source.focusedMs, className: 'is-focused' },
    { label: 'Distracted', value: source.distractedMs, className: 'is-distracted' },
    { label: 'Uncertain', value: source.uncertainMs, className: 'is-uncertain' }
  ].filter((state) => state.value > 0)

  return (
    <div className="tempo-activity-breakdown" aria-label="Classification breakdown">
      {states.map((state) => (
        <div key={state.label} className="tempo-activity-breakdown-row">
          <span className={cn('tempo-activity-state-dot', state.className)} />
          <span>{state.label}</span>
          <time>{formatDuration(state.value)}</time>
        </div>
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

  return (
    <div className="space-y-0">
      <section className="border-b px-1 pb-4">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {formatDuration(totals.focusedMs)}
              </p>
              <p className="text-xs text-muted-foreground">focused</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {formatDuration(totals.distractedMs)}
              </p>
              <p className="text-xs text-muted-foreground">distracted</p>
            </div>
          </div>
          {totals.uncertainMs > 0 && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {formatDuration(totals.uncertainMs)} uncertain
            </p>
          )}
          <div className="space-y-2 border-t pt-3">
            {categoryTotals.map(({ category, durationMs }) => (
              <div key={category?._id || 'uncategorized'}>
                <div className="mb-1 flex justify-between gap-2 text-xs">
                  <span className="truncate">{category?.name || 'Uncertain'}</span>
                  <span className="tabular-nums">{formatDuration(durationMs)}</span>
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
        </div>
      </section>

      <ClassificationReview
        startDateMs={dayRange.startDateMs}
        endDateMs={dayRange.endDateMs}
        onChange={refetchEvents}
      />
      <section className="border-b py-4" aria-labelledby="activity-sources-heading">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p
            id="activity-sources-heading"
            className="text-[11px] font-medium uppercase tracking-[.12em] text-muted-foreground"
          >
            Activities
          </p>
          {summaries.length > 0 && (
            <span className="text-[11px] text-muted-foreground">By app</span>
          )}
        </div>
        {visibleSources.length > 0 ? (
          <div className="tempo-activity-source-list" role="list">
            {visibleSources.map((source) => {
              const isSelected = source === selectedSource
              return (
                <button
                  type="button"
                  key={source.displayKey}
                  role="listitem"
                  aria-pressed={isSelected}
                  onClick={() => onSelectSession(sourceRepresentative(source))}
                  className={cn('tempo-activity-source-row', isSelected && 'is-selected')}
                >
                  <NativeAppIcon appName={source.ownerName} size={20} />
                  <span className="min-w-0 flex-1">
                    <span className="tempo-activity-source-name">{source.label}</span>
                    <span className="tempo-activity-source-subtitle">
                      {timeRange(source)} · tracked today
                    </span>
                  </span>
                  <span className="tempo-activity-source-duration">
                    <time>{formatDuration(source.totalDurationMs)}</time>
                    <ActivityStateRail {...source} />
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="py-1 text-xs text-muted-foreground">No tracked activity yet.</p>
        )}
        {summaries.length > 6 && (
          <Button
            variant="ghost"
            size="xs"
            className="mt-2 w-full justify-start text-xs text-muted-foreground"
            onClick={() => setShowAllActivities((value) => !value)}
          >
            {showAllActivities ? 'Show fewer apps' : `Show ${summaries.length - 6} more apps`}
          </Button>
        )}
      </section>

      <section className="py-4" aria-label="Selected activity details">
        {selectedSource && sessionForInspector ? (
          <div className="tempo-activity-inspector">
            <div className="tempo-activity-inspector-heading">
              <NativeAppIcon appName={selectedSource.ownerName} size={24} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{selectedSource.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {timeRange(selectedSource)} ·{' '}
                  {selectedSource.sessions.length === 1
                    ? '1 activity'
                    : `${selectedSource.sessions.length} activities`}
                </p>
              </div>
              <time className="text-sm font-semibold tabular-nums">
                {formatDuration(selectedSource.totalDurationMs)}
              </time>
            </div>

            <div className="mt-3">
              <ActivityStateRail {...selectedSource} />
              <StateBreakdown source={selectedSource} />
            </div>

            <div className="tempo-activity-inspector-section">
              <p className="tempo-activity-inspector-label">Most of this time</p>
              {sourceActivities(selectedSource).map((activity) => (
                <div key={activity.label} className="tempo-activity-detail-row">
                  <span className="min-w-0 truncate">{activity.label}</span>
                  <time>{formatDuration(activity.durationMs)}</time>
                </div>
              ))}
            </div>

            <div className="tempo-activity-inspector-section">
              <p className="tempo-activity-inspector-label">Selected activity</p>
              <div className="flex items-start gap-2">
                {sessionForInspector.isProductive === true ? (
                  <Focus className="mt-0.5 shrink-0 text-[hsl(152_58%_44%)]" size={15} />
                ) : sessionForInspector.isProductive === false ? (
                  <TriangleAlert className="mt-0.5 shrink-0 text-[hsl(351_78%_59%)]" size={15} />
                ) : (
                  <Clock3 className="mt-0.5 shrink-0 text-[hsl(38_92%_50%)]" size={15} />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-5">{sessionForInspector.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {timeRange(sessionForInspector)} ·{' '}
                    {formatDuration(sessionForInspector.activeDurationMs)}
                  </p>
                  {contextCopy && (
                    <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{contextCopy}</p>
                  )}
                  {sessionForInspector.classificationStatus?.startsWith('manual') && (
                    <p className="mt-1.5 text-xs text-muted-foreground">Manually corrected</p>
                  )}
                </div>
              </div>
            </div>

            <div className="tempo-activity-inspector-action">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="xs" disabled={recategorize.isLoading}>
                    {recategorize.isLoading ? 'Updating…' : 'Change selected activity…'}
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
              <span className="text-xs text-muted-foreground">Only this activity changes.</span>
            </div>
          </div>
        ) : (
          <div className="tempo-activity-inspector-empty">
            <Clock3 size={17} />
            <div>
              <p className="font-medium">Activity details</p>
              <p>Select an app to see its time and classification mix.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
