import type { ProcessedEventBlock } from '../components/DashboardView'

export function weekDurationLabel(milliseconds: number): string | null {
  const minutes = Math.floor(milliseconds / 60_000)
  if (minutes < 1) return null
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
}

export function buildWeekColumns(events: ProcessedEventBlock[], selected: Date) {
  const sunday = new Date(selected)
  sunday.setDate(sunday.getDate() - sunday.getDay())
  sunday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sunday)
    date.setDate(date.getDate() + index)
    const end = new Date(date)
    end.setDate(end.getDate() + 1)
    const categories = new Map<
      string,
      { id: string; name: string; color: string; productive: boolean; durationMs: number }
    >()
    for (const event of events) {
      if (event.startTime < date || event.startTime >= end) continue
      const productive = Boolean(event.isProductive)
      const id = `${productive}:${event.categoryId || 'uncategorized'}`
      const category = categories.get(id) || {
        id,
        name: event.categoryName || 'Uncategorized',
        color: event.categoryColor || '#808080',
        productive,
        durationMs: 0
      }
      category.durationMs += event.durationMs
      categories.set(id, category)
    }
    const values = [...categories.values()].sort((a, b) => b.durationMs - a.durationMs)
    return {
      date,
      categories: values,
      focusedMs: values.filter((c) => c.productive).reduce((sum, c) => sum + c.durationMs, 0),
      distractedMs: values.filter((c) => !c.productive).reduce((sum, c) => sum + c.durationMs, 0)
    }
  })
}
