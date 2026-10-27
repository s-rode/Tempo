import { useEffect, useRef, useState } from 'react'
import type { Category } from 'shared'
import { resolveDistractionSound } from 'shared'
import { useAuth } from '../contexts/AuthContext'
import { trpc } from '../utils/trpc'
import {
  canPlayDistractionSound,
  DistractionSoundScheduler
} from '../lib/distractionSoundScheduler'

export function useDistractionSound(
  categoryDetails: Category | null | undefined,
  trackingActive = true,
  classificationStatus?: string
) {
  const { token } = useAuth()
  const { data: settings } = trpc.user.getElectronAppSettings.useQuery(
    { token: token || '' },
    { enabled: !!token }
  )
  const [loaded, setLoaded] = useState<{ id: string; audio: HTMLAudioElement } | null>(null)
  const sound = resolveDistractionSound(settings?.distractionSound).id
  const audio = loaded?.id === sound ? loaded.audio : null
  const scheduler = useRef<DistractionSoundScheduler | null>(null)
  const eligible = canPlayDistractionSound(
    settings?.playDistractionSound === true,
    trackingActive,
    categoryDetails?.isProductive,
    classificationStatus
  )
  const intervalMs = (settings?.distractionSoundInterval ?? 30) * 1000

  useEffect(() => {
    if (!eligible || audio) return
    let cancelled = false
    void window.api
      .getAudioDataUrl(sound)
      .then((url) => {
        if (url && !cancelled) setLoaded({ id: sound, audio: new Audio(url) })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [eligible, audio, sound])

  useEffect(() => {
    if (!audio) return
    const current = new DistractionSoundScheduler(
      (interval) => window.api.claimDistractionSound(interval),
      () => {
        void audio.play().catch(() => {})
      }
    )
    scheduler.current = current
    return () => {
      current.dispose()
      audio.pause()
      scheduler.current = null
    }
  }, [audio])

  useEffect(() => {
    scheduler.current?.update(eligible, intervalMs)
    if (!eligible && audio) {
      audio.pause()
      audio.currentTime = 0
    }
  }, [eligible, intervalMs, audio])
}
