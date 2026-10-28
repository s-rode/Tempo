import { calendarPeriod } from '../lib/calendarPeriod'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActiveWindowEvent, Category } from 'shared'
import { useAuth } from '../contexts/AuthContext'
import {
  ActivitySessionBlock,
  buildActivitySessions,
  buildTimelineChapters,
  type FocusTimelineRun
} from '../lib/activitySessions'
import { generateProcessedEventBlocks } from '../utils/eventProcessing'
import { trpc } from '../utils/trpc'
import ActivitiesByCategoryWidget from './ActivitiesByCategoryWidget'
import CalendarWidget from './CalendarWidget'
import DaySummaryPanel from './DaySummaryPanel'
import TopActivityWidget from './TopActivityWidget'
import { TodayPlan } from './TodayPlan'
import { DashboardFocusCard } from './analytics/DashboardFocusCard'
import { PaneResizeHandle } from './layout/PaneResizeHandle'

const DAY_INSPECTOR_MIN_WIDTH = 260
const DAY_INSPECTOR_DEFAULT_WIDTH = 320
const DAY_TIMELINE_MIN_WIDTH = 320

const persistedPaneWidth = (key: string, fallback: number): number => {
  const value = Number(localStorage.getItem(key))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export interface ProcessedEventBlock {
  startTime: Date
  endTime: Date
  durationMs: number
  name: string
  ownerName: string
  title?: string // event.title
  url?: string
  activityKey: string
  activityLabel: string
  activitySummary?: string
  categoryReasoning?: string
  classificationStatus?: ActiveWindowEvent['classificationStatus']
  categoryId?: string | null
  categoryName?: string
  categoryColor?: string
  isProductive?: boolean
  eventIds: string[]
  originalEvent: ActiveWindowEvent
}

export function DashboardView({
  className,
  nowActivity,
  todayPlanOpenRequest = 0
}: {
  className?: string
  nowActivity?: ReactNode
  todayPlanOpenRequest?: number
}) {
  const { token } = useAuth()
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day')
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [calendarProcessedEvents, setCalendarProcessedEvents] = useState<
    ProcessedEventBlock[] | null
  >(null)
  const [isLoadingEvents, setIsLoadingEvents] = useState(true)
  const [selectedHour, setSelectedHour] = useState<number | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [selectedActivityKey, setSelectedActivityKey] = useState<string | null>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const [workspaceWidth, setWorkspaceWidth] = useState(() => window.innerWidth)
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    persistedPaneWidth('tempoDayInspectorWidth', DAY_INSPECTOR_DEFAULT_WIDTH)
  )

  const { startDateMs, endDateMs } = useMemo(
    () => calendarPeriod(selectedDate, viewMode),
    [selectedDate, viewMode]
  )

  const inspectorMaxWidth = Math.max(
    DAY_INSPECTOR_MIN_WIDTH,
    workspaceWidth - DAY_TIMELINE_MIN_WIDTH - 1
  )

  useEffect(() => {
    const element = workspaceRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setWorkspaceWidth(width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setInspectorWidth((width) =>
      Math.min(inspectorMaxWidth, Math.max(DAY_INSPECTOR_MIN_WIDTH, width))
    )
  }, [inspectorMaxWidth])

  useEffect(() => {
    localStorage.setItem('tempoDayInspectorWidth', String(inspectorWidth))
  }, [inspectorWidth])

  // The day outline has its own source of truth even when the adjacent week
  // view is selected. This lets a returned focus run span midnight without
  // leaking its goal into another calendar day.
  const timelineDayRange = useMemo(() => {
    const start = new Date(selectedDate)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return { startDateMs: start.getTime(), endDateMs: end.getTime() }
  }, [selectedDate])

  const { data: categoriesData, isLoading: isLoadingCategories } =
    trpc.category.getCategories.useQuery({ token: token || '' }, { enabled: !!token })
  const categories = categoriesData as Category[] | undefined

  const {
    data: eventsData,
    isLoading: isLoadingFetchedEvents,
    refetch: refetchEvents
  } = trpc.activeWindowEvents.getEventsForDateRange.useQuery(
    { token: token || '', startDateMs, endDateMs },
    {
      enabled: !!token,
      // Activity creation and correction explicitly invalidate this query.
      // Polling the full timeline every thirty seconds used CPU/database work
      // even while the observed activity had not changed.
      refetchOnWindowFocus: true
    }
  )

  const { data: focusTimelineRuns } = trpc.focusRuntime.getTimelineRuns.useQuery(
    { token: token || '', ...timelineDayRange },
    { enabled: !!token && viewMode === 'day', refetchOnWindowFocus: true }
  )

  useEffect(() => {
    if (isLoadingFetchedEvents || isLoadingCategories) {
      setIsLoadingEvents(true)
      setCalendarProcessedEvents(null)
    } else if (eventsData && categories) {
      const blocks = generateProcessedEventBlocks(eventsData, categories)
      setCalendarProcessedEvents(blocks)
      setIsLoadingEvents(false)
    } else {
      setCalendarProcessedEvents(null)
      setIsLoadingEvents(false)
    }
  }, [eventsData, isLoadingFetchedEvents, categories, isLoadingCategories])

  const activityWidgetProcessedEvents = useMemo(() => {
    if (!calendarProcessedEvents) {
      return null
    }
    if (selectedHour !== null) {
      return calendarProcessedEvents.filter((block) => block.startTime.getHours() === selectedHour)
    }
    if (viewMode === 'week' && selectedDay) {
      return calendarProcessedEvents.filter(
        (block) => block.startTime.toDateString() === selectedDay.toDateString()
      )
    }
    return calendarProcessedEvents
  }, [calendarProcessedEvents, selectedHour, selectedDay, viewMode])

  const daySessions = useMemo(
    () =>
      viewMode === 'day' && calendarProcessedEvents
        ? buildActivitySessions(calendarProcessedEvents, { foldBrief: false })
        : [],
    [calendarProcessedEvents, viewMode]
  )
  const dayChapters = useMemo(
    () => buildTimelineChapters(daySessions, focusTimelineRuns as FocusTimelineRun[] | undefined),
    [daySessions, focusTimelineRuns]
  )

  const handleDateChange = (newDate: Date) => {
    setSelectedDate(newDate)
    setSelectedHour(null)
    setSelectedDay(null)
    setSelectedSessionId(null)
    setSelectedActivityKey(null)
  }

  const handleViewModeChange = (newMode: 'day' | 'week') => {
    setViewMode(newMode)
    setSelectedHour(null)
    setSelectedDay(null)
    setSelectedSessionId(null)
    setSelectedActivityKey(null)
  }

  const handleHourSelect = useCallback((hour: number | null) => {
    setSelectedHour(hour)
    setSelectedDay(null)
  }, [])

  const handleDaySelect = useCallback((day: Date | null) => {
    setSelectedDay(day)
    setSelectedHour(null)
  }, [])

  const handleSelectSession = useCallback((session: ActivitySessionBlock) => {
    setSelectedSessionId(session.id)
    setSelectedActivityKey(session.displayKey)
  }, [])

  return (
    <div ref={workspaceRef} className={`flex flex-1 min-h-0 overflow-hidden ${className || ''}`}>
      <aside
        className="min-h-0 shrink-0 overflow-y-auto bg-card scrollbar-thin"
        style={{ width: inspectorWidth, flexBasis: inspectorWidth }}
      >
        {nowActivity}
        <div className="tempo-inspector-section">
          {viewMode === 'day' && (
            <TodayPlan selectedDate={selectedDate} openRequest={todayPlanOpenRequest} />
          )}
          <DashboardFocusCard />
          {viewMode === 'day' ? (
            <DaySummaryPanel
              dayRange={timelineDayRange}
              sessions={daySessions}
              categories={categories || []}
              selectedSessionId={selectedSessionId}
              selectedActivityKey={selectedActivityKey}
              onSelectSession={handleSelectSession}
              refetchEvents={refetchEvents}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <ActivitiesByCategoryWidget
                processedEvents={activityWidgetProcessedEvents}
                isLoadingEvents={isLoadingEvents}
                refetchEvents={refetchEvents}
                selectedHour={selectedHour}
                onHourSelect={handleHourSelect}
                selectedDay={selectedDay}
                onDaySelect={handleDaySelect}
              />
              <TopActivityWidget
                processedEvents={activityWidgetProcessedEvents}
                isLoadingEvents={isLoadingEvents}
              />
            </div>
          )}
        </div>
      </aside>
      <PaneResizeHandle
        ariaLabel="Resize Today inspector and timeline"
        value={inspectorWidth}
        min={DAY_INSPECTOR_MIN_WIDTH}
        max={inspectorMaxWidth}
        defaultValue={DAY_INSPECTOR_DEFAULT_WIDTH}
        onValueChange={setInspectorWidth}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-card">
        <CalendarWidget
          selectedDate={selectedDate}
          processedEvents={calendarProcessedEvents}
          isLoadingEvents={isLoadingEvents}
          viewMode={viewMode}
          onDateChange={handleDateChange}
          onViewModeChange={handleViewModeChange}
          selectedHour={selectedHour}
          onHourSelect={handleHourSelect}
          selectedDay={selectedDay}
          onDaySelect={handleDaySelect}
          daySessions={daySessions}
          dayChapters={dayChapters}
          selectedSessionId={selectedSessionId}
          selectedActivityKey={selectedActivityKey}
          onSelectSession={handleSelectSession}
        />
      </div>
    </div>
  )
}
