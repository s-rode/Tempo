import { app, BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron'

export type TempoDesktopCommand =
  | 'dashboard'
  | 'analysis'
  | 'settings'
  | 'toggle-sidebar'
  | 'start-focus'
  | 'pause-or-resume'

function showMainWindow(getWindow: () => BrowserWindow | null) {
  const window = getWindow()
  if (!window) return
  if (!window.isVisible()) window.show()
  window.focus()
}

function sendCommand(getWindow: () => BrowserWindow | null, command: TempoDesktopCommand) {
  showMainWindow(getWindow)
  getWindow()?.webContents.send('tempo-desktop-command', command)
}

export function installTempoMenu(getWindow: () => BrowserWindow | null) {
  const command = (label: string, accelerator: string, value: TempoDesktopCommand): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => sendCommand(getWindow, value)
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Tempo',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        command('Settings…', 'Command+,', 'settings'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        command('Start Focus Session…', 'Command+N', 'start-focus'),
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        command('Today', 'Command+1', 'dashboard'),
        command('Analysis', 'Command+2', 'analysis'),
        command('Settings', 'Command+3', 'settings'),
        { type: 'separator' },
        command('Toggle Sidebar', 'Command+Control+S', 'toggle-sidebar'),
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Focus',
      submenu: [
        command('Start Focus Session…', 'Command+N', 'start-focus'),
        command('Pause or Resume', 'Command+Shift+P', 'pause-or-resume')
      ]
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
    { label: 'Help', submenu: [{ role: 'toggleDevTools', visible: process.env.NODE_ENV === 'development' }] }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  if (process.platform === 'darwin') {
    app.dock?.setMenu(Menu.buildFromTemplate([
      { label: 'Show Tempo', click: () => showMainWindow(getWindow) },
      { label: 'Start Focus Session…', click: () => sendCommand(getWindow, 'start-focus') },
      { label: 'Pause or Resume', click: () => sendCommand(getWindow, 'pause-or-resume') }
    ]))
  }
}
