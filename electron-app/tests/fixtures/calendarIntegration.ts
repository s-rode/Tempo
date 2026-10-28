import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dir, '../..')
const folder = mkdtempSync(join(tmpdir(), 'tempo-calendar-lifecycle-'))
const handlers = new Map<string, Function>()
const app = new EventEmitter(),
  powerMonitor = new EventEmitter()
let permission = 'denied',
  requests = 0
const now = Date.now()
const event = {
  id: 'event',
  title: 'Meeting',
  calendarId: 'calendar',
  startMs: now - 60_000,
  endMs: now + 3600_000,
  allDay: false
}
const future = {
  ...event,
  id: 'future',
  startMs: now + 30 * 86400_000,
  endMs: now + 30 * 86400_000 + 3600_000
}
const calendars = [{ id: 'calendar', title: 'Work', accountName: 'Local', color: '#007aff' }]
const gates: boolean[] = [],
  notices: any[] = [],
  requestsToServer: any[] = []
mock.module('electron', () => ({
  app,
  powerMonitor,
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: async () => '' },
  ipcMain: {
    handle: (name: string, handler: Function) => {
      assert(!handlers.has(name), `Duplicate IPC handler ${name}`)
      handlers.set(name, handler)
    },
    removeHandler: (name: string) => handlers.delete(name)
  }
}))
mock.module(join(root, 'src/main/runtime.ts'), () => ({ runtime: { dataDir: folder } }))
mock.module(join(root, 'src/main/localServer.ts'), () => ({
  tempoInternalRequest: async (_path: string, input: any) => {
    requestsToServer.push(input)
    return {}
  }
}))
mock.module(join(root, 'src/native-modules/native-windows/index.ts'), () => ({
  nativeWindows: {
    getCalendarPermission: () => permission,
    getCalendarAccessDiagnostic: () => ({ currentPermission: permission }),
    requestCalendarAccess: async () => {
      requests++
      permission = 'granted'
      return permission
    },
    fetchCalendarEvents: async (start: number, end: number) => ({
      calendars,
      events: [event, future].filter((e) => e.startMs < end && e.endMs > start)
    }),
    startCalendarObserver: () => {}
  }
}))
const { startCalendarIntegration } = await import(join(root, 'src/main/calendar.ts'))
const notch: any = {
  state: 'ready',
  presentCalendarNotice: (notice: any) => notices.push(notice),
  setCalendarPause: () => {}
}
const monitoring: any = { setCalendarPaused: (value: boolean) => gates.push(value) }
const invoke = (name: string, ...args: any[]) => handlers.get(name)!(null, ...args)
let stop: Function | undefined
try {
  stop = startCalendarIntegration(notch, monitoring)
  await invoke('calendar-connect')
  assert.equal(
    requests,
    1,
    'explicit Connect refreshes a stale prior denial instead of rejecting it'
  )
  assert.equal((await invoke('calendar-status')).preferences.enabled, true)
  await invoke('calendar-respond', 'event', 'pause')
  assert.equal(gates.at(-1), true)
  assert.equal(requestsToServer.at(-1).untilMs, event.endMs)
  await invoke('calendar-status', { startMs: future.startMs, endMs: future.endMs })
  await invoke('calendar-respond', 'future', 'pause')
  assert(
    (await invoke('calendar-status')).scheduledPauseIds.includes('future'),
    'a future day can schedule its event'
  )
  permission = 'denied'
  await invoke('calendar-refresh')
  assert.equal(gates.at(-1), false, 'revoking access clears the calendar-owned gate')
  assert.equal((await invoke('calendar-status')).events.length, 0)
  stop()
  stop()
  assert.equal(handlers.size, 0, 'stop removes every handler without registering any')
  assert.equal(notch.onCalendarResume, undefined)
  stop = startCalendarIntegration(notch, monitoring)
  assert.equal(handlers.size, 8, 'restarting registers exactly one copy of each handler')
  stop()
  assert.equal(handlers.size, 0)
  console.log('Calendar lifecycle verified')
} finally {
  stop?.()
  rmSync(folder, { recursive: true, force: true })
}
