import { app, BrowserWindow, ipcMain, powerMonitor, shell } from 'electron'
import { nativeWindows } from '../native-modules/native-windows'
import { tempoInternalRequest } from './localServer'
import { ReminderSyncCoordinator } from './reminderSyncCoordinator'

export function startReminderIntegration(): () => void {
  if (process.platform !== 'darwin' || false) return () => {}
  const coordinator = new ReminderSyncCoordinator({
    readState: () => tempoInternalRequest('/internal/reminders'),
    writeState: async (update) => {
      await tempoInternalRequest('/internal/reminders', update)
    },
    permission: () => nativeWindows.getRemindersPermission(),
    requestAccess: () => nativeWindows.requestRemindersAccess(),
    fetch: () => nativeWindows.fetchReminders(),
    observe: (callback) => nativeWindows.startRemindersObserver(callback),
    changed: () => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send('reminders-changed')
      nativeWindows.refreshActiveWindow()
    }
  })
  ipcMain.handle('reminders-connect', () => coordinator.connect())
  ipcMain.handle('reminders-disconnect', () => coordinator.disconnect())
  ipcMain.handle('reminders-refresh', () => coordinator.refresh())
  ipcMain.handle('reminders-open', () => shell.openExternal('x-apple-reminderkit://'))
  const refresh = () => {
    void coordinator.refresh().catch(() => {})
  }
  app.on('activate', refresh)
  app.on('browser-window-focus', refresh)
  powerMonitor.on('resume', refresh)
  // Also catches day/time-zone changes and server recovery without a window.
  const interval = setInterval(refresh, 60_000)
  interval.unref()
  refresh()
  return () => {
    coordinator.stop()
    clearInterval(interval)
    app.removeListener('activate', refresh)
    app.removeListener('browser-window-focus', refresh)
    powerMonitor.removeListener('resume', refresh)
    for (const channel of [
      'reminders-connect',
      'reminders-disconnect',
      'reminders-refresh',
      'reminders-open'
    ])
      ipcMain.removeHandler(channel)
  }
}
