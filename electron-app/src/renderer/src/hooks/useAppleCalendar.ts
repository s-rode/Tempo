import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalendarStatus } from 'shared/calendar'

export function useAppleCalendar(range?: { startMs: number; endMs: number }) {
  const [status, setStatus] = useState<CalendarStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const reload = useCallback(async () => {
    if (!window.api?.getAppleCalendarStatus) return
    const current = ++generation.current
    try {
      const value = await window.api.getAppleCalendarStatus(range)
      if (current === generation.current) {
        setStatus(value)
        setError(null)
      }
    } catch (reason) {
      if (current === generation.current)
        setError(reason instanceof Error ? reason.message : 'Calendar is unavailable.')
    }
  }, [range?.startMs, range?.endMs])
  useEffect(() => {
    void reload()
    const unsubscribe = window.api?.onAppleCalendarChanged(reload)
    return () => {
      generation.current += 1
      unsubscribe?.()
    }
  }, [reload])
  return { status, error, reload }
}
