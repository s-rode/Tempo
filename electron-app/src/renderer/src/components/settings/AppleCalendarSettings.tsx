import { useEffect, useState } from 'react'
import type { CalendarPreferences } from 'shared/calendar'
import { CalendarDays, RefreshCw } from 'lucide-react'
import { useAppleCalendar } from '../../hooks/useAppleCalendar'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'

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
  return (
    <div className="tempo-calendar-settings">
      <div className="tempo-settings-row">
        <div>
          <h2 className="flex items-center gap-2">
            <CalendarDays size={15} aria-hidden="true" />
            Apple Calendar
          </h2>
          <p>
            Compare your calendar with tracked activity. Tempo only reads events and keeps them on
            this Mac.
          </p>
        </div>
        {connected ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void update({ enabled: false })}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void run(() => window.api.connectAppleCalendar())}
          >
            {busy ? 'Connecting…' : 'Connect Apple Calendar'}
          </Button>
        )}
      </div>
      {(error || loadError || status?.error) && (
        <p role="status" className="mt-2 text-xs text-destructive">
          {error ||
            loadError ||
            (status?.error === 'permission_denied'
              ? 'Calendar permission was removed. Reconnect to allow access in System Settings.'
              : 'Calendar could not refresh. Showing the last successful update.')}
        </p>
      )}
      {connected && (
        <div className="space-y-4 pt-3">
          <fieldset disabled={busy}>
            <legend className="mb-2 text-xs font-medium">Calendars shown in your timeline</legend>
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
            {status.calendars.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No calendars found. Add an account in Apple Calendar, then refresh.
              </p>
            )}
          </fieldset>
          <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
            <div>
              <label htmlFor="calendar-pause-prompt" className="text-sm font-medium">
                Ask to pause tracking for events
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                A quiet prompt in the notch lets you pause for a timed event or keep tracking.
                All-day events never prompt.
              </p>
            </div>
            <Switch
              id="calendar-pause-prompt"
              checked={status.preferences.askToPause}
              disabled={busy}
              onCheckedChange={(value) => void update({ askToPause: value })}
            />
          </div>
          {status.preferences.askToPause && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="calendar-lead-minutes" className="text-xs">
                  Ask
                </label>
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
                  className="h-7 w-16 rounded border border-input bg-background px-2 text-xs"
                />
                <span className="text-xs">minutes before the event</span>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => void window.api.previewCalendarPrompt()}
                >
                  Preview in notch
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                0 asks at the start. Accepting an early prompt schedules the pause for the event’s
                start. Tracking and focus timers resume when the event ends; separate manual pauses
                still apply.
              </p>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
            <span className="text-[11px] text-muted-foreground">
              {status.updatedAtMs
                ? `Updated ${new Date(status.updatedAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : 'Waiting for calendar data'}
            </span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={() => void run(() => window.api.refreshAppleCalendar())}
              >
                <RefreshCw size={12} aria-hidden="true" />
                Refresh
              </Button>
              <Button variant="ghost" size="xs" onClick={() => void window.api.openAppleCalendar()}>
                Open Calendar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
