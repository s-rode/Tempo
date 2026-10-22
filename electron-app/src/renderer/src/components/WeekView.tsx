import { useMemo } from 'react'
import { getDarkerColor, processColor } from '../lib/colors'
import type { ProcessedEventBlock } from './DashboardView'
import { notionStyleCategoryColors } from './settings/CategoryManagement'
import { buildWeekColumns, weekDurationLabel } from '../lib/weekColumns'

interface WeekViewProps {
  processedEvents: ProcessedEventBlock[] | null
  selectedDate: Date
  isDarkMode: boolean
  weekViewMode: 'stacked' | 'grouped'
  selectedDay: Date | null
  onDaySelect: (day: Date | null) => void
}

/** Tempo's original 18-hour scale and Sunday boundaries, implemented over its current event contract. */
export default function WeekView(props: WeekViewProps) {
  const columns = useMemo(
    () => buildWeekColumns(props.processedEvents || [], props.selectedDate),
    [props.processedEvents, props.selectedDate]
  )
  const height = (duration: number) => `${Math.min(100, (duration / 64_800_000) * 100)}%`
  const color = (value: string, stacked = false) =>
    processColor(value, {
      isDarkMode: props.isDarkMode,
      opacity: props.isDarkMode ? 0.7 : stacked ? 0.5 : 0.6,
      ...(stacked ? { saturation: 1.2, lightness: 1.1 } : {})
    })
  return (
    <div className="flex-1 h-full grid grid-cols-7">
      {columns.map((column) => {
        const selected = props.selectedDay?.toDateString() === column.date.toDateString()
        const today = column.date.toDateString() === new Date().toDateString()
        const total = column.focusedMs + column.distractedMs
        return (
          <button
            key={column.date.getTime()}
            type="button"
            aria-pressed={selected}
            aria-label={`${column.date.toLocaleDateString()}: ${weekDurationLabel(total) || 'No activity'}`}
            onClick={() => props.onDaySelect(selected ? null : column.date)}
            className={`flex min-w-0 flex-col border-r border-border last:border-r-0 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${selected ? 'bg-blue-200/20 dark:bg-blue-800/30' : ''}`}
          >
            <div
              className={`w-full text-center text-xs p-1 border-b border-border ${today && !selected ? 'bg-blue-100 dark:bg-blue-900' : ''}`}
            >
              <div className="font-semibold">
                {column.date.toLocaleDateString(undefined, { weekday: 'short' })}
              </div>
              <div className="text-muted-foreground">{column.date.getDate()}</div>
            </div>
            <div className="flex-1 min-h-0 w-full flex items-end overflow-hidden">
              {props.weekViewMode === 'grouped' ? (
                <div className="w-full h-full flex justify-evenly items-end">
                  {[column.focusedMs, column.distractedMs].map(
                    (duration, index) =>
                      duration > 0 && (
                        <div
                          key={index}
                          className="w-1/3 rounded-lg transition-all duration-300"
                          style={{
                            height: height(duration),
                            backgroundColor: color(notionStyleCategoryColors[index])
                          }}
                        />
                      )
                  )}
                </div>
              ) : (
                <div
                  className="w-full flex flex-col rounded-lg overflow-hidden transition-all duration-300"
                  style={{ height: height(total) }}
                >
                  {[true, false].map((productive) => {
                    const duration = productive ? column.focusedMs : column.distractedMs
                    if (!duration) return null
                    return (
                      <div
                        key={String(productive)}
                        className="w-full flex flex-col overflow-hidden"
                        style={{ height: `${(duration / total) * 100}%` }}
                      >
                        {column.categories
                          .filter((category) => category.productive === productive)
                          .map((category) => {
                            const portion = (category.durationMs / duration) * 100
                            return (
                              <div
                                key={category.id}
                                className="w-full flex items-center justify-center overflow-hidden transition-all duration-300"
                                title={`${category.name}: ${weekDurationLabel(category.durationMs) || 'Less than a minute'}`}
                                style={{
                                  height: `${portion}%`,
                                  backgroundColor: color(category.color, true)
                                }}
                              >
                                {portion > 10 && (
                                  <span
                                    className="text-sm font-medium truncate"
                                    style={{
                                      color: getDarkerColor(
                                        category.color,
                                        props.isDarkMode ? 0.8 : 0.5
                                      )
                                    }}
                                  >
                                    {weekDurationLabel(category.durationMs)}
                                  </span>
                                )}
                              </div>
                            )
                          })}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="w-full flex items-center justify-center text-muted-foreground text-xs p-1 border-t border-border h-12">
              {weekDurationLabel(total)}
            </div>
          </button>
        )
      })}
    </div>
  )
}
