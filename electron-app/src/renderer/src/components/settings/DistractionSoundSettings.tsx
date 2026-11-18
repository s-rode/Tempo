import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { DISTRACTION_SOUNDS, resolveDistractionSound, type DistractionSoundId } from 'shared'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../utils/trpc'
import { toast } from '../../hooks/use-toast'
import { Switch } from '../ui/switch'
import { Button } from '../ui/button'
import { SettingsPlaceholder, SettingsRow, SettingsSection } from './SettingsLayout'

const REMINDER_INTERVALS = [
  { value: 60, label: 'Every minute' },
  { value: 120, label: 'Every 2 minutes' },
  { value: 300, label: 'Every 5 minutes' },
  { value: 600, label: 'Every 10 minutes' }
]

const SOUND_INTERVALS = [
  { value: 5, label: 'Every 5 seconds' },
  { value: 10, label: 'Every 10 seconds' },
  { value: 30, label: 'Every 30 seconds' },
  { value: 60, label: 'Every minute' },
  { value: 120, label: 'Every 2 minutes' },
  { value: 300, label: 'Every 5 minutes' }
]

const DistractionSoundSettings = () => {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const [sound, setSound] = useState<DistractionSoundId>('pop')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const preview = useRef<HTMLAudioElement | null>(null)
  const previewGeneration = useRef(0)
  const [playDistractionSound, setPlayDistractionSound] = useState(true)
  const [distractionSoundInterval, setDistractionSoundInterval] = useState(30) // in seconds
  const [showDistractionNotifications, setShowDistractionNotifications] = useState(true)
  const [showDistractionNotchAlerts, setShowDistractionNotchAlerts] = useState(true)
  const [distractionNotificationInterval, setDistractionNotificationInterval] = useState(60) // in seconds

  const { data: electronSettings, isLoading } = trpc.user.getElectronAppSettings.useQuery(
    { token: token || '' },
    { enabled: !!token }
  )

  const updateSettingsMutation = trpc.user.updateElectronAppSettings.useMutation({
    onSuccess: () => void utils.user.getElectronAppSettings.invalidate(),
    onError: () => {
      toast({
        title: 'Could not save distraction alerts',
        description: 'Tempo kept your previous settings.',
        variant: 'destructive'
      })
      // Revert on error to stay in sync with the backend
      if (electronSettings) {
        setSound(resolveDistractionSound(electronSettings.distractionSound).id)
        setPlayDistractionSound(electronSettings.playDistractionSound)
        setDistractionSoundInterval(electronSettings.distractionSoundInterval)
        setShowDistractionNotifications(electronSettings.showDistractionNotifications)
        setShowDistractionNotchAlerts(electronSettings.showDistractionNotchAlerts !== false)
        setDistractionNotificationInterval(
          Math.max(60, electronSettings.distractionNotificationInterval || 60)
        )
      }
    }
  })

  // Load settings when data is fetched
  useEffect(() => {
    if (electronSettings) {
      setSound(resolveDistractionSound(electronSettings.distractionSound).id)
      setPlayDistractionSound(electronSettings.playDistractionSound)
      setDistractionSoundInterval(electronSettings.distractionSoundInterval)
      setShowDistractionNotifications(electronSettings.showDistractionNotifications)
      setShowDistractionNotchAlerts(electronSettings.showDistractionNotchAlerts !== false)
      setDistractionNotificationInterval(
        Math.max(60, electronSettings.distractionNotificationInterval || 60)
      )
    }
  }, [electronSettings])

  const stopPreview = () => {
    previewGeneration.current++
    preview.current?.pause()
    preview.current = null
    setPreviewLoading(false)
  }
  useEffect(
    () => () => {
      previewGeneration.current++
      preview.current?.pause()
    },
    []
  )

  const handleSoundChange = (value: string) => {
    if (!token) return
    stopPreview()
    setPreviewError('')
    const id = resolveDistractionSound(value).id
    setSound(id)
    // Patch only this preference; preserve the user's alert toggles and cadence.
    updateSettingsMutation.mutate({ token, distractionSound: id })
  }

  const previewSound = async () => {
    stopPreview()
    const generation = previewGeneration.current
    setPreviewLoading(true)
    setPreviewError('')
    try {
      const url = await window.api.getAudioDataUrl(sound)
      if (generation !== previewGeneration.current) return
      if (!url) throw new Error('Sound unavailable')
      const audio = new Audio(url)
      preview.current = audio
      await audio.play()
    } catch {
      if (generation === previewGeneration.current)
        setPreviewError('Could not play this sound. Check your audio output and try again.')
    } finally {
      if (generation === previewGeneration.current) setPreviewLoading(false)
    }
  }

  const handlePlaySoundChange = (isChecked: boolean) => {
    if (!token) return
    setPlayDistractionSound(isChecked)
    updateSettingsMutation.mutate({
      token,
      playDistractionSound: isChecked,
      distractionSoundInterval,
      showDistractionNotifications,
      showDistractionNotchAlerts,
      distractionNotificationInterval
    })
  }

  const handleIntervalChange = (value: string) => {
    if (!token) return
    const interval = Number(value)
    setDistractionSoundInterval(interval)
    updateSettingsMutation.mutate({
      token,
      playDistractionSound,
      distractionSoundInterval: interval,
      showDistractionNotifications,
      showDistractionNotchAlerts,
      distractionNotificationInterval
    })
  }

  const handleShowNotificationsChange = (isChecked: boolean) => {
    if (!token) return
    setShowDistractionNotifications(isChecked)
    updateSettingsMutation.mutate({
      token,
      playDistractionSound,
      distractionSoundInterval,
      showDistractionNotifications: isChecked,
      showDistractionNotchAlerts,
      distractionNotificationInterval
    })
  }

  const handleNotificationIntervalChange = (value: string) => {
    if (!token) return
    const interval = Number(value)
    setDistractionNotificationInterval(interval)
    updateSettingsMutation.mutate({
      token,
      playDistractionSound,
      distractionSoundInterval,
      showDistractionNotifications,
      showDistractionNotchAlerts,
      distractionNotificationInterval: interval
    })
  }

  const handleShowNotchAlertsChange = (isChecked: boolean) => {
    if (!token) return
    setShowDistractionNotchAlerts(isChecked)
    updateSettingsMutation.mutate({
      token,
      playDistractionSound,
      distractionSoundInterval,
      showDistractionNotifications,
      showDistractionNotchAlerts: isChecked,
      distractionNotificationInterval
    })
  }

  if (isLoading) {
    return (
      <SettingsSection title="Distraction alerts">
        <SettingsPlaceholder>Loading…</SettingsPlaceholder>
      </SettingsSection>
    )
  }

  const busy = updateSettingsMutation.isLoading || !token
  return (
    <SettingsSection
      title="Distraction alerts"
      description="How Tempo nudges you when activity drifts away from your goal."
    >
      <SettingsRow
        title="Reminders"
        htmlFor="show-notifications-switch"
        description="Personalized wording is written locally in the background and never delays classification."
        control={
          <Switch
            id="show-notifications-switch"
            size="sm"
            checked={showDistractionNotifications}
            disabled={busy}
            onCheckedChange={handleShowNotificationsChange}
          />
        }
      />
      <SettingsRow
        title="Repeat reminders"
        htmlFor="notification-interval-select"
        inactive={!showDistractionNotifications}
        control={
          <select
            id="notification-interval-select"
            className="tempo-pref-select"
            value={distractionNotificationInterval}
            disabled={!showDistractionNotifications || busy}
            onChange={(event) => handleNotificationIntervalChange(event.target.value)}
          >
            {REMINDER_INTERVALS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        }
      />
      <SettingsRow
        title="Show in the notch"
        htmlFor="show-notch-reminders-switch"
        description="Expands the notch briefly, with actions to open Tempo or correct the category."
        inactive={!showDistractionNotifications}
        control={
          <Switch
            id="show-notch-reminders-switch"
            size="sm"
            checked={showDistractionNotchAlerts}
            disabled={!showDistractionNotifications || busy}
            onCheckedChange={handleShowNotchAlertsChange}
          />
        }
      />
      <SettingsRow
        title="Sound alert"
        htmlFor="play-sound-switch"
        control={
          <Switch
            id="play-sound-switch"
            size="sm"
            checked={playDistractionSound}
            disabled={busy}
            onCheckedChange={handlePlaySoundChange}
          />
        }
      />
      <SettingsRow
        title="Repeat sound"
        htmlFor="sound-interval-select"
        inactive={!playDistractionSound}
        control={
          <select
            id="sound-interval-select"
            className="tempo-pref-select"
            value={distractionSoundInterval}
            disabled={!playDistractionSound || busy}
            onChange={(event) => handleIntervalChange(event.target.value)}
          >
            {SOUND_INTERVALS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        }
      />
      <SettingsRow
        title="Sound"
        htmlFor="distraction-sound-choice"
        description={
          <span id="distraction-sound-description">
            {resolveDistractionSound(sound).description}. A built-in Mac sound. Preview works even
            when sound alerts are off.
            {previewError && (
              <span role="status" className="mt-1 block text-destructive">
                {previewError}
              </span>
            )}
          </span>
        }
        control={
          <>
            <Button
              type="button"
              variant="ghost"
              size="compact"
              className="tempo-pref-icon-button"
              onClick={() => void previewSound()}
              disabled={previewLoading}
              aria-label={`Preview ${resolveDistractionSound(sound).name} sound`}
              title="Preview"
            >
              <Volume2 aria-hidden="true" />
            </Button>
            <select
              id="distraction-sound-choice"
              className="tempo-pref-select"
              value={sound}
              onChange={(event) => handleSoundChange(event.target.value)}
              disabled={busy}
              aria-describedby="distraction-sound-description"
            >
              {DISTRACTION_SOUNDS.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </select>
          </>
        }
      />
    </SettingsSection>
  )
}

export default DistractionSoundSettings
