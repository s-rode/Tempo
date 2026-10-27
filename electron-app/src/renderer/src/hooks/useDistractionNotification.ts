import { useEffect, useRef } from 'react'
import { type ActiveWindowEvent, type Category } from 'shared'
import { useAuth } from '../contexts/AuthContext'
import {
  DistractionNudgeLoader,
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
  const prepareNudge = trpc.activeWindowEvents.prepareDistractionNotification.useMutation()
  const copyLoader = useRef(new DistractionNudgeLoader())
  const lastAttemptRef = useRef<number | null>(null)
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
      lastAttemptRef.current = null
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
      lastAttemptRef.current = null
    }
    if (!distractionStartRef.current) distractionStartRef.current = Date.now()
    const intervalMs = distractionNotificationIntervalMs(
      (electronSettings as any)?.distractionNotificationInterval
    )
    const primaryGoal = sessionGoal || goalContext?.primaryGoal || 'your current goal'

    let cancelled = false
    const notify = async () => {
      const now = Date.now()
      if (!latestEvent || !distractionStartRef.current || now - distractionStartRef.current < intervalMs) return
      if (lastNotifiedRef.current && now - lastNotifiedRef.current < intervalMs) return
      let copy = distractionNotificationCopy(latestEvent, primaryGoal)
      if (token && latestEvent.eventId) {
        const key = `${latestEvent.eventId}:${latestEvent.goalContextFingerprint || ''}:${primaryGoal}`
        const prepared = await copyLoader.current.load(key, () =>
          prepareNudge.mutateAsync({ token, eventId: latestEvent.eventId! })
        )
        if (cancelled) return
        lastAttemptRef.current = Date.now()
        // The server rejected a stale activity, changed goal, pause or setting.
        if (prepared === null) return
        if (prepared.copy) copy = prepared.copy
      }
      if (cancelled) return
      const { title, body } = copy
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
      lastNotifiedRef.current = Date.now()
    }
    let timeoutId: number | null = null
    const scheduleNext = () => {
      const nextDeliveryAt =
        (Math.max(lastAttemptRef.current || 0, lastNotifiedRef.current || 0) || distractionStartRef.current || Date.now()) + intervalMs
      timeoutId = window.setTimeout(() => {
        if (cancelled) return
        void notify().finally(() => {
          if (!cancelled) scheduleNext()
        })
      }, Math.max(0, nextDeliveryAt - Date.now()))
    }
    scheduleNext()
    return () => {
      cancelled = true
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [categoryDetails, latestEvent, electronSettings, goalContext, trackingActive, sessionGoal, token, prepareNudge.mutateAsync])
}
