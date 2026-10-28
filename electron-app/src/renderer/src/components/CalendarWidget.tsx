import { Calendar1, CalendarDaysIcon, ChevronLeft, ChevronRight, Layers } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useDarkMode } from '../hooks/useDarkMode'
import { useWindowWidth } from '../hooks/useWindowWidth'
import type { ActivitySessionBlock, TimelineChapter } from '../lib/activitySessions'
import type { ProcessedEventBlock } from './DashboardView'
import { DayCalendarComparison } from './DayCalendarComparison'
import CompactDayTimeline from './CompactDayTimeline'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Switch } from './ui/switch'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import WeekView from './WeekView'

interface CalendarWidgetProps {
  selectedDate: Date
  onDateChange: (newDate: Date) => void
  viewMode: 'day' | 'week'
  onViewModeChange: (newMode: 'day' | 'week') => void
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
  onSelectSession
}: CalendarWidgetProps) => {
  const isDarkMode = useDarkMode()
  const [wasSetToToday, setWasSetToToday] = useState(false)
  const [weekViewMode, setWeekViewMode] = useState<'stacked' | 'grouped'>('grouped')
  const width = useWindowWidth()

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
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Button variant="ghost" size="xs" className="tempo-date-button" onClick={handlePrev} aria-label={`Previous ${viewMode}`}>
              <ChevronLeft size={20} />
            </Button>
            <span className="tempo-date-title">{formattedDate}</span>
            <Button variant="ghost" size="xs" className="tempo-date-button" onClick={handleNext} disabled={!canGoNext()} aria-label={`Next ${viewMode}`}>
              <ChevronRight size={20} />
            </Button>
            {viewMode === 'day' && (
              <Button variant="ghost" size="xs" className="tempo-date-now" onClick={() => onDateChange(new Date())} disabled={isToday}>
                Today
              </Button>
            )}
          </div>
          {viewMode === 'week' && (
            <div className="flex items-center space-x-2">
              <Switch
                id="week-view-mode"
                checked={weekViewMode === 'stacked'}
                onCheckedChange={(checked) => setWeekViewMode(checked ? 'stacked' : 'grouped')}
              />
              {width >= 1000 ? (
                <Label htmlFor="week-view-mode" className="text-muted-foreground font-normal">
                  Stacked
                </Label>
              ) : (
                <Label htmlFor="week-view-mode" className="text-muted-foreground">
                  <Layers className="text-muted-foreground" size={16} />
                </Label>
              )}
            </div>
          )}
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={viewMode}
            onValueChange={(value) => {
              if (value) onViewModeChange(value as 'day' | 'week')
            }}
          >
            <ToggleGroupItem value="week">
              <CalendarDaysIcon size={16} />
            </ToggleGroupItem>
            <ToggleGroupItem value="day">
              <Calendar1 size={16} />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </header>

      {viewMode === 'day' ? (
        <div className="flex-1 overflow-y-auto">
          <DayCalendarComparison date={selectedDate} sessions={daySessions} onSelectSession={onSelectSession} />
          <CompactDayTimeline
            sessions={daySessions}
            chapters={dayChapters}
            selectedSessionId={selectedSessionId}
            selectedActivityKey={selectedActivityKey}
            onSelectSession={onSelectSession}
          />
        </div>
      ) : (
        <WeekView
          processedEvents={processedEvents}
          selectedDate={selectedDate}
          isDarkMode={isDarkMode}
          weekViewMode={weekViewMode}
          selectedDay={selectedDay}
          onDaySelect={onDaySelect}
        />
      )}
    </section>
  )
}

export default CalendarWidget
