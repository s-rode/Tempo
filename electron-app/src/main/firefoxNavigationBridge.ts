import { app, BrowserWindow } from 'electron'
import { createHmac, randomBytes } from 'crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import net, { Server } from 'net'
import { join } from 'path'

export interface FirefoxNavigationState {
  tabId: number
  windowId: number
  documentId: string
  navigationGeneration: number
  title: string
  navigationFingerprint: string
  reason: 'activation' | 'navigation' | 'reload' | 'title_change'
}

const localAppSupport = join(app.getPath('home'), 'Library', 'Application Support', 'Kronus')
const socketPath = join(localAppSupport, 'firefox-native.sock')
const nativeManifestPath = join(
  app.getPath('home'),
  'Library',
  'Application Support',
  'Mozilla',
  'NativeMessagingHosts',
  'com.kronus.local.firefox.json'
)

function navigationSecret(): string {
  const secretPath = join(localAppSupport, 'firefox-navigation-secret')
  if (existsSync(secretPath)) return readFileSync(secretPath, 'utf8').trim()
  mkdirSync(localAppSupport, { recursive: true, mode: 0o700 })
  const value = randomBytes(32).toString('base64url')
  writeFileSync(secretPath, `${value}\n`, { mode: 0o600 })
  return value
}

function hostExecutablePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'firefox-host', 'kronus-firefox-native-host')
  }
  return join(app.getAppPath(), 'build-resources', 'firefox-host', 'kronus-firefox-native-host')
}

function installNativeManifest(): void {
  const parent = join(app.getPath('home'), 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts')
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  const manifest = {
    name: 'com.kronus.local.firefox',
    description: 'Kronus local Firefox navigation companion',
    path: hostExecutablePath(),
    type: 'stdio',
    allowed_extensions: ['kronus-firefox@local.invalid']
  }
  writeFileSync(nativeManifestPath, `${JSON.stringify(manifest)}\n`, { mode: 0o600 })
  chmodSync(nativeManifestPath, 0o600)
}

function parseNavigation(value: unknown): FirefoxNavigationState | null {
  if (!value || typeof value !== 'object') return null
  const message = value as Record<string, unknown>
  if (message.type !== 'navigation' || message.private === true) return null
  const { tabId, windowId, documentId, navigationGeneration, title, url, reason } = message
  if (
    !Number.isInteger(tabId) || !Number.isInteger(windowId) ||
    typeof documentId !== 'string' || !documentId ||
    !Number.isInteger(navigationGeneration) ||
    typeof title !== 'string' || typeof url !== 'string' || !url ||
    !['activation', 'navigation', 'reload', 'title_change'].includes(String(reason))
  ) return null
  const fingerprint = createHmac('sha256', navigationSecret())
    .update(`${url}\u0000${documentId}\u0000${navigationGeneration}`)
    .digest('hex')
  return {
    tabId: tabId as number,
    windowId: windowId as number,
    documentId,
    navigationGeneration: navigationGeneration as number,
    title,
    navigationFingerprint: fingerprint,
    reason: reason as FirefoxNavigationState['reason']
  }
}

/** Receives private, extension-authorized navigation metadata over a local socket. */
export class FirefoxNavigationBridge {
  private server: Server | null = null
  private mainWindow: () => BrowserWindow | null
  private onNavigation: (state: FirefoxNavigationState) => void

  constructor(mainWindow: () => BrowserWindow | null, onNavigation: (state: FirefoxNavigationState) => void) {
    this.mainWindow = mainWindow
    this.onNavigation = onNavigation
  }

  start(): void {
    mkdirSync(localAppSupport, { recursive: true, mode: 0o700 })
    if (existsSync(socketPath)) unlinkSync(socketPath)
    installNativeManifest()
    this.server = net.createServer((socket) => {
      let input = ''
      socket.setEncoding('utf8')
      socket.on('data', (chunk) => {
        input += chunk
        const lines = input.split('\n')
        input = lines.pop() || ''
        for (const line of lines) {
          try {
            const state = parseNavigation(JSON.parse(line))
            if (state) {
              this.onNavigation(state)
              this.mainWindow()?.webContents.send('firefox-navigation-state', state)
            }
          } catch {
            // Untrusted/malformed native-host input is deliberately ignored.
          }
        }
      })
    })
    this.server.listen(socketPath, () => chmodSync(socketPath, 0o600))
    this.server.on('error', () => undefined)
  }

  stop(): void {
    this.server?.close()
    this.server = null
    if (existsSync(socketPath)) unlinkSync(socketPath)
  }
}
