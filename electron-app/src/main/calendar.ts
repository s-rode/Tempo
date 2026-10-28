import { app, BrowserWindow, ipcMain, powerMonitor, shell } from 'electron'
import { readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import type {
  CalendarPauseNotice,
  CalendarPreferences,
  CalendarSnapshot,
  CalendarStatus
} from '../../../shared/calendar'
import { defaultCalendarPreferences } from '../../../shared/calendar'
import { nativeWindows } from '../native-modules/native-windows'
import { runtime } from './runtime'
import { tempoInternalRequest } from './localServer'
import type { NotchHelper } from './notchHelper'
import type { ActivityMonitoringCoordinator } from './activityMonitoringCoordinator'
import { calendarSchedule, type CalendarDecisions } from './calendarSchedule'

export function startCalendarIntegration(
  notch: NotchHelper,
  monitoring: ActivityMonitoringCoordinator
): () => void {
  const path = join(runtime.dataDir, 'calendar-preferences.json')
  let preferences: CalendarPreferences = { ...defaultCalendarPreferences }
  let decisions: CalendarDecisions = {}
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    preferences = { ...preferences, ...saved.preferences }
    decisions = saved.decisions || {}
  } catch {}
  const queriedEvents = new Map<string, import('../../../shared/calendar').CalendarEvent>()
  let snapshot: CalendarSnapshot = { calendars: [], events: [] }
  let error: string | null = null
  let updatedAtMs: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let observing = false
  let generation = 0
  let refreshing: Promise<void> | undefined
  let deliveredNotice = ''
  let appliedPause: string | undefined
  let tail = Promise.resolve()
  const save = () => {
    writeFileSync(`${path}.tmp`, JSON.stringify({ preferences, decisions }), { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
  }
  const changed = () => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('calendar-changed')
  }
  const plan = () => {
    const events = new Map(
      [...queriedEvents.values()]
        .filter((event) => decisions[event.id]?.action === 'pause')
        .map((event) => [event.id, event])
    )
    for (const event of snapshot.events) events.set(event.id, event)
    return calendarSchedule(preferences, [...events.values()], decisions, Date.now(), !error)
  }
  const enqueue = (work: () => Promise<void>) => {
    const result = tail.then(work)
    tail = result.catch(() => {})
    return result
  }
  const reconcile = (): Promise<void> =>
    enqueue(async () => {
      if (stopped) return
      clearTimeout(timer)
      const next = plan()
      const notice = next.notice
        ? {
            ...next.notice,
            calendarName:
              snapshot.calendars.find(
                (calendar) =>
                  calendar.id ===
                  snapshot.events.find((event) => event.id === next.notice!.id)?.calendarId
              )?.title || 'Calendar'
          }
        : null
      const noticeKey = JSON.stringify(notice)
      if (noticeKey !== deliveredNotice) {
        if (notice && !decisions[notice.id]) {
          decisions[notice.id] = { action: 'pending', endMs: notice.endMs }
          save()
        }
        notch.presentCalendarNotice(notice)
        deliveredNotice = noticeKey
      }
      const pauseKey = JSON.stringify([next.pauseUntilMs, next.pauseEventIds])
      try {
        if (pauseKey !== appliedPause) {
          // The Calendar gate has its own owner: renderer/manual pause updates
          // cannot clear it, and its end cannot clear a user's separate pause.
          if (next.pauseUntilMs) {
            monitoring.setCalendarPaused(true)
            notch.setCalendarPause(next.pauseUntilMs)
          }
          await tempoInternalRequest('/internal/calendar-pause', {
            untilMs: next.pauseUntilMs,
            eventIds: next.pauseEventIds,
            timestamp: Date.now()
          })
          appliedPause = pauseKey
          if (!next.pauseUntilMs) {
            monitoring.setCalendarPaused(false)
            notch.setCalendarPause(null)
          }
          for (const window of BrowserWindow.getAllWindows())
            window.webContents.send('calendar-runtime-changed')
          changed()
        }
      } catch {
        if (!stopped) timer = setTimeout(() => void reconcile().catch(() => {}), 5_000)
        return
      }
      if (next.nextAtMs && !stopped) {
        timer = setTimeout(
          () => void reconcile().catch(() => {}),
          Math.min(2_147_000_000, Math.max(1, next.nextAtMs - Date.now()))
        )
        timer.unref()
      }
    })
  const refresh = async (): Promise<void> => {
    if (refreshing) return refreshing
    const current = generation
    refreshing = (async () => {
      if (!preferences.enabled || stopped) {
        snapshot = { calendars: [], events: [] }
        await reconcile()
        return
      }
      if (nativeWindows.getCalendarPermission() !== 'granted') {
        snapshot = { calendars: [], events: [] }
        queriedEvents.clear()
        error = 'permission_denied'
        changed()
        await reconcile()
        return
      }
      try {
        if (!observing) {
          observing = true
          nativeWindows.startCalendarObserver(() => {
            clearTimeout(refreshTimer)
            refreshTimer = setTimeout(() => void refresh().catch(() => {}), 400)
          })
        }
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        start.setDate(start.getDate() - 1)
        const end = new Date(start)
        end.setDate(end.getDate() + 16)
        const value = await nativeWindows.fetchCalendarEvents(+start, +end)
        if (stopped || current !== generation) return
        if (nativeWindows.getCalendarPermission() !== 'granted') {
          snapshot = { calendars: [], events: [] }
          queriedEvents.clear()
          error = 'permission_denied'
          changed()
          await reconcile()
          return
        }
        for (const [id, event] of queriedEvents)
          if (event.endMs > +start && event.startMs < +end) queriedEvents.delete(id)
        snapshot = value
        error = null
        updatedAtMs = Date.now()
        for (const [id, decision] of Object.entries(decisions))
          if (decision.endMs < Date.now() - 7 * 86_400_000) delete decisions[id]
        save()
      } catch {
        if (current !== generation || stopped) return
        error = 'fetch_failed'
      }
      changed()
      await reconcile()
    })().finally(() => {
      refreshing = undefined
    })
    return refreshing
  }
  const status = async (range?: { startMs: number; endMs: number }): Promise<CalendarStatus> => {
    let value = snapshot
    if (range && preferences.enabled && nativeWindows.getCalendarPermission() === 'granted') {
      if (
        !Number.isFinite(range.startMs) ||
        !Number.isFinite(range.endMs) ||
        range.endMs <= range.startMs ||
        range.endMs - range.startMs > 32 * 86_400_000
      )
        throw Error('Invalid calendar range')
      try {
        value = await nativeWindows.fetchCalendarEvents(range.startMs, range.endMs)
        if (preferences.enabled && nativeWindows.getCalendarPermission() === 'granted') {
          for (const event of value.events) queriedEvents.set(event.id, event)
        } else {
          value = { calendars: [], events: [] }
          queriedEvents.clear()
        }
      } catch {
        error = 'fetch_failed'
      }
    }
    return {
      ...value,
      preferences,
      permission: nativeWindows.getCalendarPermission(),
      error,
      updatedAtMs,
      pauseUntilMs: plan().pauseUntilMs,
      scheduledPauseIds: Object.keys(decisions).filter((id) => decisions[id].action === 'pause')
    }
  }
  const respond = async (id: string, action: 'pause' | 'keep') => {
    if (id === 'calendar-preview') {
      notch.presentCalendarNotice(null)
      deliveredNotice = ''
      await reconcile()
      return
    }
    const event = snapshot.events.find((event) => event.id === id) || queriedEvents.get(id)
    if (!event || event.endMs <= Date.now() || !['pause', 'keep'].includes(action)) return
    decisions[id] = { action, endMs: event.endMs }
    save()
    await reconcile()
    changed()
  }
  const resumeCalendar = async () => {
    for (const event of snapshot.events)
      if (
        event.startMs <= Date.now() &&
        event.endMs > Date.now() &&
        decisions[event.id]?.action === 'pause'
      )
        decisions[event.id] = { action: 'keep', endMs: event.endMs }
    save()
    await reconcile()
    changed()
  }
  notch.onCalendarResume = () => {
    void resumeCalendar().catch(() => {})
  }
  ipcMain.handle('calendar-resume', resumeCalendar)
  notch.onCalendarResponse = (id, action) => {
    void respond(id, action).catch(() => {})
  }
  ipcMain.handle('calendar-status', (_event, range) => status(range))
  ipcMain.handle('calendar-connect', async () => {
    // Re-request explicitly even after a prior denial or a change in System
    // Settings. EventKit's cached status can lag behind the permission sheet.
    const permission = await nativeWindows.requestCalendarAccess()
    // Metadata only: useful when macOS and an already-running EventKit client
    // disagree after the user changes Calendar access. Never logs event data.
    writeFileSync(
      join(runtime.dataDir, 'calendar-access-diagnostics.json'),
      JSON.stringify(nativeWindows.getCalendarAccessDiagnostic()),
      { mode: 0o600 }
    )
    if (permission !== 'granted')
      throw Error(
        'Allow Tempo in System Settings → Privacy & Security → Calendars, then connect again.'
      )
    generation += 1
    preferences.enabled = true
    save()
    await refreshing?.catch(() => {})
    await refresh()
    return status()
  })
  ipcMain.handle('calendar-preferences', async (_event, input: Partial<CalendarPreferences>) => {
    if (
      !input ||
      (input.leadMinutes !== undefined &&
        (!Number.isInteger(input.leadMinutes) || input.leadMinutes < 0 || input.leadMinutes > 120))
    )
      throw Error('Choose 0 to 120 minutes before the event.')
    if (
      input.selectedCalendarIds !== undefined &&
      input.selectedCalendarIds !== null &&
      (!Array.isArray(input.selectedCalendarIds) ||
        input.selectedCalendarIds.some((id) => typeof id !== 'string'))
    )
      throw Error('Invalid calendar selection')
    if (input.askToPause !== undefined && typeof input.askToPause !== 'boolean')
      throw Error('Invalid prompt preference')
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
      throw Error('Invalid connection preference')
    generation += 1
    preferences = { ...preferences, ...input }
    save()
    if (!preferences.enabled) {
      snapshot = { calendars: [], events: [] }
      error = null
      decisions = {}
      queriedEvents.clear()
      save()
    }
    await reconcile()
    changed()
    if (preferences.enabled) {
      await refreshing?.catch(() => {})
      await refresh()
    }
    return status()
  })
  ipcMain.handle('calendar-refresh', async () => {
    await refresh()
    return status()
  })
  ipcMain.handle('calendar-respond', (_event, id, action) => respond(id, action))
  ipcMain.handle('calendar-preview', () => {
    if (notch.state !== 'ready')
      throw Error('The notch is unavailable. Retry its helper in Settings first.')
    const now = Date.now()
    notch.presentCalendarNotice({
      id: 'calendar-preview',
      title: 'Your next calendar event',
      calendarName: 'Preview · tracking stays unchanged',
      startMs: now + preferences.leadMinutes * 60_000,
      endMs: now + (preferences.leadMinutes + 30) * 60_000,
      preview: true
    })
  })
  ipcMain.handle('calendar-open', () => shell.openPath('/System/Applications/Calendar.app'))
  const onWake = () => {
    void refresh()
      .then(reconcile)
      .catch(() => {})
  }
  app.on('activate', onWake)
  powerMonitor.on('resume', onWake)
  const interval = setInterval(() => void refresh().catch(() => {}), 60_000)
  interval.unref()
  void refresh().catch(() => {})
  return () => {
    if (stopped) return
    stopped = true
    generation += 1
    clearTimeout(timer)
    clearTimeout(refreshTimer)
    clearInterval(interval)
    app.removeListener('activate', onWake)
    powerMonitor.removeListener('resume', onWake)
    notch.onCalendarResponse = undefined
    notch.onCalendarResume = undefined
    for (const channel of [
      'calendar-status',
      'calendar-connect',
      'calendar-preferences',
      'calendar-refresh',
      'calendar-respond',
      'calendar-preview',
      'calendar-open',
      'calendar-resume'
    ])
      ipcMain.removeHandler(channel)
  }
}
