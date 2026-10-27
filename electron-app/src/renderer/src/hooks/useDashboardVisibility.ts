import { useEffect, useState } from 'react'

/** Chromium visibility is unreliable when backgroundThrottling is disabled. */
export function useDashboardVisibility(): boolean {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let active = true
    let receivedEvent = false
    const unsubscribe = window.api.onDashboardVisibilityChanged((next) => {
      receivedEvent = true
      if (active) setVisible(next)
    })
    void window.api.getDashboardVisibility().then((next) => {
      if (active && !receivedEvent) setVisible(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return visible
}
