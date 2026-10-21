import type { NativeReminder, ReminderDueDate, ReminderFilter } from '../../../shared/reminders';

export const calendarDay = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
export const reminderDueDay = (due: ReminderDueDate, timeZone: string): string =>
  due.hour !== undefined && due.timestampMs !== undefined
    ? calendarDay(new Date(due.timestampMs), timeZone)
    : `${due.year}-${String(due.month).padStart(2, '0')}-${String(due.day).padStart(2, '0')}`;

export function matchesReminderFilter(
  reminder: NativeReminder,
  filter: ReminderFilter,
  now = Date.now(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
): boolean {
  if (reminder.completed) return false;
  const today = calendarDay(new Date(now), timeZone);
  const day = reminder.due ? reminderDueDay(reminder.due, timeZone) : null;
  const results = filter.rules.map((rule) => {
    switch (rule.kind) {
      case 'due_today':
        return day === today;
      case 'overdue':
        return day !== null && day < today;
      case 'due_later':
        return day !== null && day > today;
      case 'no_due_date':
        return day === null;
      case 'list':
        return rule.listIds.includes(reminder.listId);
    }
  });
  return (
    !results.length || (filter.match === 'all' ? results.every(Boolean) : results.some(Boolean))
  );
}

export const reminderClassificationText = (
  title: string,
  listName: string,
  customContext = '',
  listContext = ''
): string => {
  const intent = customContext.trim() || listContext.trim();
  return `${title.slice(0, 500)}\nList: ${listName.slice(0, 100)}${intent ? `\nFocus context: ${intent.slice(0, 1000)}` : ''}`;
};
