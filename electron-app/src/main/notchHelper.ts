import { app, BrowserWindow } from 'electron'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { join } from 'path'
import { Category } from 'shared/dist/types'

export interface FloatingStatusUpdate {
  latestStatus: 'productive' | 'unproductive' | 'maybe' | null
  dailyProductiveMs: number
  dailyUnproductiveMs: number
  productiveClock?: { accumulatedMs: number; runningSinceMs: number | null }
  distractedClock?: { accumulatedMs: number; runningSinceMs: number | null }
  provisionalDistractionStartedAtMs?: number | null
  productiveStreakMs?: number
  distractedStreakMs?: number
  statusStartedAtMs?: number | null
  categoryDetails?: Category
  availableCategories?: Category[]
  activityName?: string
  activitySummary?: string | null
  activityUrl?: string
  categoryReasoning?: string | null
  classificationStatus?: string
  nudgeTitle?: string | null
  nudgeBody?: string | null
  eventIds?: string[]
  runtimeMode?: 'normal' | 'custom' | 'pomodoro'
  trackingState?: 'normal' | 'active' | 'paused' | 'break'
  suspensionReasons?: string[]
  suspendedAtMs?: number | null
  pausedUntilMs?: number | null
  phaseRemainingMs?: number | null
  phaseDurationMs?: number | null
  phaseGoal?: string | null
  phaseKind?: 'work' | 'short_break' | 'long_break' | null
  phaseIndex?: number | null
}

type NotchEvent =
  | { version: 3; type: 'ready' }
  | { version: 3; type: 'visibilityChanged'; visible: boolean }
  | { version: 3; type: 'openMain' }
  | { version: 3; type: 'recategorize'; requestId: string; categoryId: string; eventIds: string[] }
  | { version: 3; type: 'focusCommand'; action: 'pause' | 'resume' | 'skipBreak' | 'endRun'; durationMinutes?: number }
  | { version: 3; type: 'error'; code: string }

type HelperAvailability = 'starting' | 'ready' | 'unavailable'

const protocolVersion = 3

export class NotchHelper {
  private child: ChildProcessWithoutNullStreams | null = null
  private lineBuffer = ''
  private lastStatus: FloatingStatusUpdate | null = null
  private availability: HelperAvailability = 'starting'
  private restartCount = 0
  private stopped = false
  private mainWindow: () => BrowserWindow | null

  constructor(mainWindow: () => BrowserWindow | null) {
    this.mainWindow = mainWindow
  }

  get state(): HelperAvailability {
    return this.availability
  }

  get visible(): boolean {
    return this.availability === 'ready' && this.child !== null
  }

  async start(): Promise<void> {
    if (process.platform !== 'darwin') {
      this.setAvailability('unavailable')
      return
    }
    this.stopped = false
    if (this.child) return
    const executable = this.helperExecutablePath()
    try {
      this.child = spawn(executable, [], { stdio: 'pipe', windowsHide: true })
    } catch (error) {
      console.error('Could not start Tempo Notch Helper:', error)
      this.handleExit()
      return
    }
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.handleStdout(chunk))
    this.child.stderr.on('data', () => {
      // The helper must never write activity context to its stderr stream.
    })
    this.child.on('error', () => this.handleExit())
    this.child.on('exit', () => this.handleExit())
    this.setAvailability('starting')
  }

  stop(): void {
    this.stopped = true
    this.restartCount = 0
    if (!this.child) return
    this.send({ version: protocolVersion, type: 'shutdown' })
    this.child.kill()
    this.child = null
  }

  retry(): void {
    this.stop()
    this.stopped = false
    void this.start()
  }

  show(): void { this.send({ version: protocolVersion, type: 'show' }) }
  hide(): void { this.send({ version: protocolVersion, type: 'hide' }) }
  refreshGeometry(): void { this.send({ version: protocolVersion, type: 'refreshGeometry' }) }

  updateStatus(status: FloatingStatusUpdate): void {
    this.lastStatus = status
    this.send({ version: protocolVersion, type: 'status', payload: status })
  }

  /** Freeze immediately from main-process system events; renderer/server state can lag. */
  setSystemSuspension(state: { locked: boolean; sleeping: boolean; suspendedAtMs: number | null }): void {
    if (!this.lastStatus) return
    const suspensionReasons = [
      ...(state.locked ? ['screen_locked'] : []),
      ...(state.sleeping ? ['system_sleep'] : [])
    ]
    this.updateStatus({
      ...this.lastStatus,
      trackingState: suspensionReasons.length ? 'paused' : this.lastStatus.trackingState,
      suspensionReasons,
      suspendedAtMs: state.suspendedAtMs
    })
  }

  sendRecategorizeResult(result: { requestId: string; ok: boolean; message?: string }): void {
    this.send({ version: protocolVersion, type: 'recategorizeResult', ...result })
  }

  private helperExecutablePath(): string {
    if (app.isPackaged) {
      return join(
        process.resourcesPath,
        '..',
        'Helpers',
        'Tempo Notch Helper.app',
        'Contents',
        'MacOS',
        'Tempo Notch Helper'
      )
    }
    return join(app.getAppPath(), 'build-resources', 'Tempo Notch Helper.app', 'Contents', 'MacOS', 'Tempo Notch Helper')
  }

  private send(message: Record<string, unknown>): void {
    if (!this.child?.stdin.writable) return
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleStdout(chunk: string): void {
    this.lineBuffer += chunk
    const lines = this.lineBuffer.split('\n')
    this.lineBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line) as NotchEvent
        if (event.version !== protocolVersion) continue
        this.handleEvent(event)
      } catch {
        this.setAvailability('unavailable')
      }
    }
  }

  private handleEvent(event: NotchEvent): void {
    if (event.type === 'ready') {
      this.restartCount = 0
      this.setAvailability('ready')
      if (this.lastStatus) this.updateStatus(this.lastStatus)
      return
    }
    if (event.type === 'visibilityChanged') {
      this.mainWindow()?.webContents.send('floating-window-visibility-changed', event.visible)
      return
    }
    if (event.type === 'openMain') {
      const window = this.mainWindow()
      window?.show()
      window?.focus()
      return
    }
    if (event.type === 'recategorize') {
      if (!event.requestId || !event.categoryId || !event.eventIds?.length) return
      // The helper is deliberately token-free. Translate its protocol field
      // into the existing authenticated renderer mutation shape here.
      this.mainWindow()?.webContents.send('floating-recategorize-request', {
        requestId: event.requestId,
        eventIds: event.eventIds,
        newCategoryId: event.categoryId
      })
      return
    }
    if (event.type === 'focusCommand') {
      this.mainWindow()?.webContents.send('floating-focus-command', event)
      return
    }
    if (event.type === 'error') this.setAvailability('unavailable')
  }

  private handleExit(): void {
    this.child = null
    if (this.stopped) return
    if (this.restartCount >= 3) {
      this.setAvailability('unavailable')
      return
    }
    this.restartCount += 1
    this.setAvailability('starting')
    const delay = 500 * this.restartCount
    setTimeout(() => void this.start(), delay)
  }

  private setAvailability(next: HelperAvailability): void {
    if (this.availability === next) return
    this.availability = next
    this.mainWindow()?.webContents.send('notch-helper-availability', next)
  }
}
