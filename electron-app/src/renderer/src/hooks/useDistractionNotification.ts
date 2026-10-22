import { useEffect, useRef } from 'react'
import { ActiveWindowEvent, Category } from 'shared'
import { useAuth } from '../contexts/AuthContext'
import {
  distractionNotificationCopy,
  distractionNotificationIntervalMs
} from '../lib/distractionNudge'
import { trpc } from '../utils/trpc'

export const useDistractionNotification = (
  categoryDetails: Category | null | undefined,
  latestEvent: ActiveWindowEvent | null | undefined,
  trackingActive = true,
  sessionGoal?: string | null
): void => {
  const { token } = useAuth()
  const { data: electronSettings } = trpc.user.getElectronAppSettings.useQuery(
    { token: token || '' },
    { enabled: !!token, staleTime: 300000 }
  )
  const { data: goalContext } = trpc.goals.getActiveContext.useQuery(
    { token: token || '' },
    { enabled: !!token, staleTime: 300000 }
  )
  const lastNotifiedRef = useRef<number | null>(null)
  const distractionStartRef = useRef<number | null>(null)
  const activeDistractionKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const isDistracting = categoryDetails?.isProductive === false
    const safeStatus = latestEvent?.classificationStatus
    const canNudge =
      isDistracting &&
      !['ollama_unavailable', 'invalid_response', 'ocr_unavailable', 'insufficient_context'].includes(
        safeStatus || ''
      )
    if ((electronSettings as any)?.showDistractionNotifications === false || !canNudge || !trackingActive) {
      distractionStartRef.current = null
      lastNotifiedRef.current = null
      activeDistractionKeyRef.current = null
      return
    }
    const distractionKey =
      latestEvent?.eventId ||
      `${latestEvent?.timestamp || ''}:${latestEvent?.ownerName || ''}:${latestEvent?.windowId || ''}`
    if (activeDistractionKeyRef.current !== distractionKey) {
      activeDistractionKeyRef.current = distractionKey
      distractionStartRef.current = Date.now()
      lastNotifiedRef.current = null
    }
    if (!distractionStartRef.current) distractionStartRef.current = Date.now()
    const intervalMs = distractionNotificationIntervalMs(
      (electronSettings as any)?.distractionNotificationInterval
    )
    const primaryGoal = sessionGoal || goalContext?.primaryGoal || 'your current goal'

    const notify = () => {
      const now = Date.now()
      if (!latestEvent || !distractionStartRef.current || now - distractionStartRef.current < intervalMs) return
      if (lastNotifiedRef.current && now - lastNotifiedRef.current <= intervalMs) return
      const { title, body } = distractionNotificationCopy(latestEvent, primaryGoal)
      // This is deliberately an opaque, ephemeral key. It lets the main
      // process prevent duplicate alerts across a renderer reload without
      // storing activity text, URLs, OCR, prompts, or model output.
      const eventKey = latestEvent.eventId
        ? `event:${latestEvent.eventId}`
        : `capture:${latestEvent.timestamp || 0}:${latestEvent.windowId || 0}`
      window.api.showNotification({
        kind: 'distraction',
        eventKey,
        eventId: latestEvent.eventId,
        intervalMs,
        showInNotch: (electronSettings as any)?.showDistractionNotchAlerts !== false,
        title,
        body
      })
      lastNotifiedRef.current = now
    }
    let cancelled = false
    let timeoutId: number | null = null
    const scheduleNext = () => {
      const nextDeliveryAt =
        (lastNotifiedRef.current || distractionStartRef.current || Date.now()) + intervalMs
      timeoutId = window.setTimeout(() => {
        if (cancelled) return
        notify()
        if (!cancelled) scheduleNext()
      }, Math.max(0, nextDeliveryAt - Date.now()))
    }
    scheduleNext()
    return () => {
      cancelled = true
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [categoryDetails, latestEvent, electronSettings, goalContext, trackingActive, sessionGoal])
}
