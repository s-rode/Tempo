import { CalendarOff, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Category } from 'shared'
import type { ActivitySessionBlock, TimelineChapter } from '../lib/activitySessions'
import { buildDayOverview } from '../lib/dayOverview'
import type { ProcessedEventBlock, TimelineViewMode } from './DashboardView'
import { DayCalendarComparison } from './DayCalendarComparison'
import CompactDayTimeline from './CompactDayTimeline'
import DayHero from './DayHero'
import DayOverviewTimeline from './DayOverviewTimeline'
import { Button } from './ui/button'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import WeekView from './WeekView'

interface CalendarWidgetProps {
  selectedDate: Date
  onDateChange: (newDate: Date) => void
  viewMode: TimelineViewMode
  onViewModeChange: (newMode: TimelineViewMode) => void
  processedEvents: ProcessedEventBlock[] | null
  isLoadingEvents: boolean
  selectedHour: number | null
  onHourSelect: (hour: number | null) => void
  selectedDay: Date | null
  onDaySelect: (day: Date | null) => void
  daySessions: ActivitySessionBlock[]
  dayChapters: TimelineChapter[]
  selectedSessionId: string | null
  selectedActivityKey: string | null
  onSelectSession: (session: ActivitySessionBlock) => void
  categories: Category[]
  refetchEvents: () => void
}

const CalendarWidget = ({
  selectedDate,
  onDateChange,
  processedEvents,
  isLoadingEvents,
  viewMode,
  onViewModeChange,
  selectedHour,
  onHourSelect,
  selectedDay,
  onDaySelect,
  daySessions,
  dayChapters,
  selectedSessionId,
  selectedActivityKey,
  onSelectSession,
  categories,
  refetchEvents
}: CalendarWidgetProps) => {
  const [wasSetToToday, setWasSetToToday] = useState(false)
  // Navigation steps by the period shown; the overview covers one day.
  const period = viewMode === 'week' ? 'week' : 'day'

  useEffect(() => {
    setWasSetToToday(selectedDate.toDateString() === new Date().toDateString())
  }, [selectedDate])

  useEffect(() => {
    // only run this if we're viewing the current date
    if (!wasSetToToday) {
      return
    }

    // One local-midnight deadline replaces 8,640 checks per day. Constructing
    // the next calendar date also handles daylight-saving changes correctly.
    let timeout: number | undefined
    const scheduleMidnight = () => {
      const now = new Date()
      const midnight = new Date(now)
      midnight.setHours(24, 0, 0, 0)
      timeout = window.setTimeout(refreshDate, midnight.getTime() - now.getTime())
    }
    const refreshDate = () => {
      window.clearTimeout(timeout)
      const now = new Date()
      if (selectedDate.toDateString() !== now.toDateString()) onDateChange(now)
      // Re-arm if the wall clock moved back before the previous deadline.
      else scheduleMidnight()
    }
    scheduleMidnight()
    // Refresh immediately if a sleeping or hidden dashboard missed midnight.
    const onVisible = () => { if (!document.hidden) refreshDate() }
    window.addEventListener('focus', refreshDate)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('focus', refreshDate)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [wasSetToToday, selectedDate, onDateChange])

  // Check if we're viewing today
  const isToday = selectedDate.toDateString() === new Date().toDateString()
  const overview = useMemo(
    () => (viewMode === 'week' ? null : buildDayOverview(selectedDate, daySessions)),
    [viewMode, selectedDate, daySessions]
  )
  // Read at render: the day data refreshes as activity arrives, so the marker
  // follows along without a timer of its own.
  const nowMs = isToday ? Date.now() : null

  const canGoNext = () => {
    const delta = viewMode === 'week' ? 7 : 1
    const tomorrow = new Date(selectedDate)
    tomorrow.setDate(tomorrow.getDate() + delta)
    tomorrow.setHours(0, 0, 0, 0)

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    return tomorrow <= today
  }

  const handlePrev = () => {
    const newDate = new Date(selectedDate)
    const delta = viewMode === 'week' ? 7 : 1
    newDate.setDate(newDate.getDate() - delta)
    onDateChange(newDate)
  }

  const handleNext = () => {
    const newDate = new Date(selectedDate)
    const delta = viewMode === 'week' ? 7 : 1
    newDate.setDate(newDate.getDate() + delta)

    // Check if the new date would be in the future
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    newDate.setHours(0, 0, 0, 0)

    // Only allow navigation if the new date is not in the future
    if (newDate <= today) {
      onDateChange(newDate)
    }
  }

  const formattedDate = useMemo(() => {
    if (viewMode === 'week') {
      const startOfWeek = new Date(selectedDate)
      const dayOfWeek = startOfWeek.getDay() // Sunday = 0
      startOfWeek.setDate(startOfWeek.getDate() - dayOfWeek)
      startOfWeek.setHours(0, 0, 0, 0)

      const endOfWeek = new Date(startOfWeek)
      endOfWeek.setDate(startOfWeek.getDate() + 6)

      const startMonth = startOfWeek.toLocaleDateString(undefined, { month: 'short' })
      const endMonth = endOfWeek.toLocaleDateString(undefined, { month: 'short' })
      const startDay = startOfWeek.getDate()
      const endDay = endOfWeek.getDate()
      const year = endOfWeek.getFullYear()

      if (startMonth === endMonth) {
        return `${startMonth} ${startDay} - ${endDay}, ${year}`
      }
      return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`
    }
    return selectedDate.toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }, [selectedDate, viewMode])

  return (
    <section className="tempo-day-workspace h-full w-full flex flex-col" aria-label="Activity calendar">
      <header className="tempo-day-toolbar">
        <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex items-center space-x-1">
            <Button variant="ghost" size="xs" className="tempo-date-button" onClick={handlePrev} aria-label={`Previous ${period}`}>
              <ChevronLeft size={17} />
            </Button>
            <span className="tempo-date-title">{formattedDate}</span>
            <Button variant="ghost" size="xs" className="tempo-date-button" onClick={handleNext} disabled={!canGoNext()} aria-label={`Next ${period}`}>
              <ChevronRight size={17} />
            </Button>
            {period === 'day' && (
              <Button variant="ghost" size="xs" className="tempo-date-now" onClick={() => onDateChange(new Date())} disabled={isToday}>
                Today
              </Button>
            )}
          </div>
          <ToggleGroup
            type="single"
            size="sm"
            className="tempo-glass-segmented tempo-day-view-switch"
            value={viewMode}
            aria-label="View"
            onValueChange={(value) => {
              if (value) onViewModeChange(value as TimelineViewMode)
            }}
          >
            <ToggleGroupItem value="day" title="Your day as blocks, in order">
              Timeline
            </ToggleGroupItem>
            <ToggleGroupItem value="overview" title="The whole day, one row per hour">
              Hours
            </ToggleGroupItem>
            <ToggleGroupItem value="week" title="Week">
              Week
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </header>

      {viewMode === 'week' ? (
        <WeekView
          processedEvents={processedEvents}
          selectedDate={selectedDate}
          selectedDay={selectedDay}
          onDaySelect={onDaySelect}
        />
      ) : (
        <div className="tempo-day-scroll">
          {viewMode === 'day' && (
            <DayCalendarComparison
              date={selectedDate}
              sessions={daySessions}
              onSelectSession={onSelectSession}
            />
          )}
          {!overview ? (
            <div className="tempo-day-empty-state">
              <CalendarOff size={22} aria-hidden="true" />
              <p>No tracked activity</p>
              <span>
                {isToday
                  ? 'Activity appears here as you work.'
                  : 'Tempo did not record anything on this day.'}
              </span>
            </div>
          ) : viewMode === 'day' ? (
            <>
              <DayHero
                overview={overview}
                showStrip
                selectedSessionId={selectedSessionId}
                selectedActivityKey={selectedActivityKey}
                onSelectSession={onSelectSession}
                nowMs={nowMs}
              />
              <CompactDayTimeline
                sessions={daySessions}
                chapters={dayChapters}
                selectedSessionId={selectedSessionId}
                selectedActivityKey={selectedActivityKey}
                onSelectSession={onSelectSession}
              />
            </>
          ) : (
            <>
              <DayHero overview={overview} />
              <DayOverviewTimeline
                overview={overview}
                nowMs={nowMs}
                selectedSessionId={selectedSessionId}
                selectedActivityKey={selectedActivityKey}
                onSelectSession={onSelectSession}
                categories={categories}
                refetchEvents={refetchEvents}
              />
            </>
          )}
        </div>
      )}
    </section>
  )
}

export default CalendarWidget
