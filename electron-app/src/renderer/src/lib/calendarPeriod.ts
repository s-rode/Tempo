/** Calendar boundaries use local dates, including 23/25-hour DST days. */
export function calendarPeriod(selected: Date, view: 'day' | 'week') {
  const day = selected.getDate() - (view === 'week' ? selected.getDay() : 0)
  const start = new Date(selected.getFullYear(), selected.getMonth(), day)
  const end = new Date(selected.getFullYear(), selected.getMonth(), day + (view === 'week' ? 7 : 1))
  return { startDateMs: start.getTime(), endDateMs: end.getTime() }
}
