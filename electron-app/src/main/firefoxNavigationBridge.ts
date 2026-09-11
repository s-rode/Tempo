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
  pageCorrectionKey: string
  siteHost: string
  pageContent: string | null
  reason: 'activation' | 'navigation' | 'reload' | 'title_change'
}

const localAppSupport = join(app.getPath('home'), 'Library', 'Application Support', 'Tempo')
const socketPath = join(localAppSupport, 'firefox-native.sock')
const nativeManifestPath = join(
  app.getPath('home'),
  'Library',
  'Application Support',
  'Mozilla',
  'NativeMessagingHosts',
  'com.tempo.local.firefox.json'
)

function navigationSecret(): string {
  const secretPath = join(localAppSupport, 'firefox-navigation-secret')
  if (existsSync(secretPath)) return readFileSync(secretPath, 'utf8').trim()
  mkdirSync(localAppSupport, { recursive: true, mode: 0o700 })
  const value = randomBytes(32).toString('base64url')
  writeFileSync(secretPath, `${value}\n`, { mode: 0o600 })
  return value
}

function canonicalPageIdentity(url: string): string | null {
  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `${parsed.protocol}//${parsed.host.toLocaleLowerCase()}${pathname}`
    }
    return `${parsed.protocol}${pathname}`
  } catch {
    return null
  }
}

function hostExecutablePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'firefox-host', 'tempo-firefox-native-host')
  }
  return join(app.getAppPath(), 'build-resources', 'firefox-host', 'tempo-firefox-native-host')
}

function installNativeManifest(): void {
  const parent = join(
    app.getPath('home'),
    'Library',
    'Application Support',
    'Mozilla',
    'NativeMessagingHosts'
  )
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  const manifest = {
    name: 'com.tempo.local.firefox',
    description: 'Tempo local Firefox navigation companion',
    path: hostExecutablePath(),
    type: 'stdio',
    allowed_extensions: ['tempo-firefox@local.invalid']
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
    !Number.isInteger(tabId) ||
    !Number.isInteger(windowId) ||
    typeof documentId !== 'string' ||
    !documentId ||
    !Number.isInteger(navigationGeneration) ||
    typeof title !== 'string' ||
    typeof url !== 'string' ||
    !url ||
    !['activation', 'navigation', 'reload', 'title_change'].includes(String(reason))
  )
    return null
  const fingerprint = createHmac('sha256', navigationSecret())
    .update(`${url}\u0000${documentId}\u0000${navigationGeneration}`)
    .digest('hex')
  const pageIdentity = canonicalPageIdentity(url)
  if (!pageIdentity) return null
  const parsedUrl = new URL(url)
  const rawContext =
    message.pageContext && typeof message.pageContext === 'object'
      ? (message.pageContext as Record<string, unknown>)
      : null
  const clean = (value: unknown, limit: number) =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
  const headings = Array.isArray(rawContext?.headings)
    ? rawContext.headings
        .map((value) => clean(value, 180))
        .filter(Boolean)
        .slice(0, 16)
    : []
  const pageContent = [
    clean(rawContext?.description, 500),
    headings.length ? `Headings: ${headings.join(' · ')}` : '',
    clean(rawContext?.pageText, 6000)
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 6000)
  const pageCorrectionKey = createHmac('sha256', navigationSecret())
    .update(`tempo-page-correction-v1\u0000${pageIdentity}`)
    .digest('hex')
  return {
    tabId: tabId as number,
    windowId: windowId as number,
    documentId,
    navigationGeneration: navigationGeneration as number,
    title,
    navigationFingerprint: fingerprint,
    pageCorrectionKey,
    siteHost: parsedUrl.hostname.toLocaleLowerCase().slice(0, 253),
    pageContent: pageContent || null,
    reason: reason as FirefoxNavigationState['reason']
  }
}

/** Receives private, extension-authorized navigation metadata over a local socket. */
export class FirefoxNavigationBridge {
  private server: Server | null = null
  private mainWindow: () => BrowserWindow | null
  private onNavigation: (state: FirefoxNavigationState) => void

  constructor(
    mainWindow: () => BrowserWindow | null,
    onNavigation: (state: FirefoxNavigationState) => void
  ) {
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
              // DOM-derived context stays in renderer request memory. Keeping
              // it out of the Objective-C capture module both narrows the
              // native trust boundary and prevents optional JSON null values
              // from reaching Cocoa string APIs.
              this.mainWindow()?.webContents.send('firefox-navigation-state', {
                reason: state.reason,
                navigationFingerprint: state.navigationFingerprint,
                siteHost: state.siteHost,
                pageContent: state.pageContent
              })
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
