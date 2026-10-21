import type { ReminderDueDate, ReminderFilter, ReminderList } from 'shared/reminders'

export type ReminderGroup = 'overdue' | 'today' | 'upcoming' | 'unscheduled'
export const reminderGroups: Array<{ id: ReminderGroup; label: string }> = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'unscheduled', label: 'No due date' }
]
const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function reminderDatePresentation(
  due: ReminderDueDate | null,
  now = new Date()
): {
  group: ReminderGroup
  label: string
  fullLabel: string
} {
  if (!due) return { group: 'unscheduled', label: '', fullLabel: 'No due date' }
  const date =
    due.hour !== undefined && due.timestampMs !== undefined
      ? new Date(due.timestampMs)
      : new Date(due.year, due.month - 1, due.day, due.hour ?? 0, due.minute ?? 0)
  const day = dayKey(date)
  const today = dayKey(now)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const group = day < today ? 'overdue' : day === today ? 'today' : 'upcoming'
  const label =
    day === today
      ? 'Today'
      : day === dayKey(yesterday)
        ? 'Yesterday'
        : date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {})
          })
  const time =
    due.hour === undefined
      ? ''
      : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return {
    group,
    label: `${label}${time ? `, ${time}` : ''}`,
    fullLabel: date.toLocaleDateString(undefined, { dateStyle: 'full' }) + (time ? `, ${time}` : '')
  }
}

export function reminderFilterSummary(filter: ReminderFilter, lists: ReminderList[]): string {
  if (!filter.rules.length) return 'All unfinished reminders'
  const labels = filter.rules.map((rule) => {
    switch (rule.kind) {
      case 'due_today':
        return 'Due today'
      case 'overdue':
        return 'Overdue'
      case 'due_later':
        return 'Due later'
      case 'no_due_date':
        return 'No due date'
      case 'list': {
        if (!rule.listIds.length) return 'No lists selected'
        return rule.listIds
          .map((id) => lists.find((list) => list.id === id)?.name || 'Unavailable list')
          .join(', ')
      }
    }
  })
  return labels.join(filter.match === 'all' ? ' and ' : ' or ')
}
