import { useEffect, useState } from 'react'
import type { CalendarPreferences } from 'shared/calendar'
import { useAppleCalendar } from '../../hooks/useAppleCalendar'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { SettingsRow, SettingsSection } from './SettingsLayout'

export function AppleCalendarSettings() {
  const { status, error: loadError, reload } = useAppleCalendar()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lead, setLead] = useState('0')
  useEffect(() => {
    setLead(String(status?.preferences.leadMinutes || 0))
  }, [status?.preferences.leadMinutes])
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Calendar could not be updated.')
    } finally {
      setBusy(false)
    }
  }
  const update = (preferences: Partial<CalendarPreferences>) =>
    run(() => window.api.updateCalendarPreferences(preferences))
  const connected = status?.preferences.enabled && status.permission === 'granted'
  const saveLead = () => {
    const minutes = Number(lead)
    if (!/^\d+$/.test(lead) || !Number.isInteger(minutes) || minutes < 0 || minutes > 120) {
      setError('Choose a whole number from 0 to 120 minutes.')
      return
    }
    if (minutes !== status?.preferences.leadMinutes) void update({ leadMinutes: minutes })
  }
  const problem =
    error ||
    loadError ||
    (status?.error === 'permission_denied'
      ? 'Calendar permission was removed. Reconnect to allow access in System Settings.'
      : status?.error
        ? 'Calendar could not refresh. Showing the last successful update.'
        : null)
  return (
    <SettingsSection
      title="Apple Calendar"
      footer={
        problem ? (
          <p role="status" className="text-destructive">
            {problem}
          </p>
        ) : (
          connected && (
            <>
              <span>
                {status.updatedAtMs
                  ? `Updated ${new Date(status.updatedAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'Waiting for calendar data'}
              </span>
              <span className="tempo-pref-footnote-actions">
                <button
                  type="button"
                  className="tempo-pref-link"
                  disabled={busy}
                  onClick={() => void run(() => window.api.refreshAppleCalendar())}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="tempo-pref-link"
                  onClick={() => void window.api.openAppleCalendar()}
                >
                  Open Calendar
                </button>
              </span>
            </>
          )
        )
      }
    >
      <SettingsRow
        title={connected ? 'Connected' : 'Show your calendar in Tempo'}
        description="Compare your calendar with tracked activity. Tempo only reads events and keeps them on this Mac."
        control={
          connected ? (
            <Button
              variant="glass"
              size="compact"
              disabled={busy}
              onClick={() => void update({ enabled: false })}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              size="compact"
              disabled={busy}
              onClick={() => void run(() => window.api.connectAppleCalendar())}
            >
              {busy ? 'Connecting…' : 'Connect…'}
            </Button>
          )
        }
      />
      {connected && (
        <>
          <SettingsRow title="Calendars shown in your timeline">
            <fieldset disabled={busy}>
              <legend className="sr-only">Calendars shown in your timeline</legend>
              {status.calendars.length === 0 ? (
                <p className="tempo-pref-description">
                  No calendars found. Add an account in Apple Calendar, then refresh.
                </p>
              ) : (
                <div className="tempo-calendar-source-grid">
                  {status.calendars.map((calendar) => {
                    const selected =
                      status.preferences.selectedCalendarIds === null ||
                      status.preferences.selectedCalendarIds.includes(calendar.id)
                    return (
                      <label key={calendar.id} className="tempo-calendar-source">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => {
                            const ids =
                              status.preferences.selectedCalendarIds ||
                              status.calendars.map((item) => item.id)
                            void update({
                              selectedCalendarIds: selected
                                ? ids.filter((id) => id !== calendar.id)
                                : [...ids, calendar.id]
                            })
                          }}
                        />
                        <span
                          className="tempo-calendar-color"
                          style={{ background: calendar.color }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-xs">{calendar.title}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {calendar.accountName}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </fieldset>
          </SettingsRow>
          <SettingsRow
            title="Ask to pause tracking for events"
            htmlFor="calendar-pause-prompt"
            description="A quiet prompt in the notch lets you pause for a timed event or keep tracking. All-day events never prompt."
            control={
              <Switch
                id="calendar-pause-prompt"
                size="sm"
                checked={status.preferences.askToPause}
                disabled={busy}
                onCheckedChange={(value) => void update({ askToPause: value })}
              />
            }
          />
          {status.preferences.askToPause && (
            <SettingsRow
              title="Ask before the event"
              htmlFor="calendar-lead-minutes"
              description="0 asks at the start. Accepting early schedules the pause for the event’s start, and tracking resumes when it ends. Manual pauses still apply."
              control={
                <>
                  <Button
                    variant="ghost"
                    size="compact"
                    disabled={busy}
                    onClick={() => void window.api.previewCalendarPrompt()}
                  >
                    Preview
                  </Button>
                  <span className="tempo-pref-stepper">
                    <input
                      id="calendar-lead-minutes"
                      type="number"
                      min="0"
                      max="120"
                      step="1"
                      value={lead}
                      disabled={busy}
                      onChange={(event) => setLead(event.target.value)}
                      onBlur={saveLead}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') saveLead()
                      }}
                      className="tempo-pref-input tempo-pref-number"
                    />
                    <span>min</span>
                  </span>
                </>
              }
            />
          )}
        </>
      )}
    </SettingsSection>
  )
}
