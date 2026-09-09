import { app, BrowserWindow } from 'electron'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { join } from 'path'
import { Category } from 'shared/dist/types'

export interface FloatingStatusUpdate {
  latestStatus: 'productive' | 'unproductive' | 'maybe' | null
  dailyProductiveMs: number
  dailyUnproductiveMs: number
  /** Live workday totals used by the expanded notch without renderer polling. */
  dailyProductiveClock?: { accumulatedMs: number; runningSinceMs: number | null }
  dailyUnproductiveClock?: { accumulatedMs: number; runningSinceMs: number | null }
  productiveClock?: { accumulatedMs: number; runningSinceMs: number | null }
  distractedClock?: { accumulatedMs: number; runningSinceMs: number | null }
  provisionalDistractionStartedAtMs?: number | null
  productiveStreakMs?: number
  distractedStreakMs?: number
  statusStartedAtMs?: number | null
  animateTimerDigits?: boolean
  categoryDetails?: Category
  availableCategories?: Category[]
  /** Foreground app/site identity. Kept separate from the AI-derived label. */
  activitySource?: string
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
  /** Timestamp at which the phase remainder was sampled by the renderer. */
  phaseRemainingSampledAtMs?: number | null
  phaseDurationMs?: number | null
  phaseGoal?: string | null
  phaseKind?: 'work' | 'short_break' | 'long_break' | null
  phaseIndex?: number | null
  sessionTransitionAlertsEnabled?: boolean
  playSessionTransitionChime?: boolean
  showDistractionNotchAlerts?: boolean
  transitionNotice?: {
    id: string
    kind: 'focus_complete' | 'break_started' | 'break_complete' | 'pomodoro_complete'
    runId: string
    phaseId: string
    phaseIndex: number
    occurredAtMs: number
    goal: string | null
    breakDurationMs: number | null
  } | null
}

export interface DistractionAttentionNotice {
  id: string
  eventId: string
  title: string
  body: string
  occurredAtMs: number
}

type NotchEvent =
  | { version: 5; type: 'ready' }
  | { version: 5; type: 'visibilityChanged'; visible: boolean }
  | { version: 5; type: 'openMain' }
  | { version: 5; type: 'openFocusGoal' }
  | { version: 5; type: 'recategorize'; requestId: string; categoryId: string; eventIds: string[] }
  | {
      version: 5
      type: 'focusCommand'
      action: 'pause' | 'resume' | 'skipBreak' | 'endRun'
      durationMinutes?: number
    }
  | { version: 5; type: 'error'; code: string }

type HelperAvailability = 'starting' | 'ready' | 'unavailable'

const protocolVersion = 5

export class NotchHelper {
  private child: ChildProcessWithoutNullStreams | null = null
  private lineBuffer = ''
  private lastStatus: FloatingStatusUpdate | null = null
  private availability: HelperAvailability = 'starting'
  private restartCount = 0
  private stopped = false
  /** Main-process lifetime dedupe survives a helper-only restart. */
  private deliveredTransitionNoticeIds = new Set<string>()
  /** A fallback beep was already played while the helper was unavailable. */
  private externallyChimedTransitionNoticeIds = new Set<string>()
  /** The state to restore after only the system-owned freeze reasons clear. */
  private trackingStateBeforeSystemSuspension: FloatingStatusUpdate['trackingState'] | null = null
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

  show(): void {
    this.send({ version: protocolVersion, type: 'show' })
  }
  hide(): void {
    this.send({ version: protocolVersion, type: 'hide' })
  }
  refreshGeometry(): void {
    this.send({ version: protocolVersion, type: 'refreshGeometry' })
  }

  /**
   * A distraction card is transient by design. The main process calls this
   * only when it has accepted the same scheduled reminder for Notification
   * Center, and the helper independently verifies the current activity.
   */
  presentDistractionNotice(notice: DistractionAttentionNotice): void {
    if (!this.canPresentDistractionNotice(notice)) return
    this.send({ version: protocolVersion, type: 'distractionNotice', distractionNotice: notice })
  }

  updateStatus(status: FloatingStatusUpdate): void {
    this.lastStatus = status
    const noticeId = status.transitionNotice?.id
    const shouldSuppressNotice = Boolean(
      noticeId && this.deliveredTransitionNoticeIds.has(noticeId)
    )
    const shouldSuppressChime = Boolean(
      noticeId && this.externallyChimedTransitionNoticeIds.has(noticeId)
    )
    if (noticeId && this.availability === 'ready' && !shouldSuppressNotice) {
      this.deliveredTransitionNoticeIds.add(noticeId)
      if (this.deliveredTransitionNoticeIds.size > 64) {
        const oldest = this.deliveredTransitionNoticeIds.values().next().value
        if (oldest) this.deliveredTransitionNoticeIds.delete(oldest)
      }
    }
    this.send({
      version: protocolVersion,
      type: 'status',
      payload: {
        ...status,
        ...(shouldSuppressNotice ? { transitionNotice: null } : {}),
        ...(shouldSuppressChime ? { playSessionTransitionChime: false } : {})
      }
    })
  }

  /** Ensures an Electron fallback beep cannot be followed by a helper chime. */
  markTransitionChimeDeliveredElsewhere(noticeId: string): void {
    if (!noticeId) return
    this.externallyChimedTransitionNoticeIds.add(noticeId)
    if (this.externallyChimedTransitionNoticeIds.size > 64) {
      const oldest = this.externallyChimedTransitionNoticeIds.values().next().value
      if (oldest) this.externallyChimedTransitionNoticeIds.delete(oldest)
    }
  }

  /** Freeze immediately from main-process system events; renderer/server state can lag. */
  setSystemSuspension(state: {
    locked: boolean
    sleeping: boolean
    suspendedAtMs: number | null
  }): void {
    if (!this.lastStatus) return
    const systemReasons = [
      ...(state.locked ? ['screen_locked'] : []),
      ...(state.sleeping ? ['system_sleep'] : [])
    ]
    const previousReasons = this.lastStatus.suspensionReasons || []
    const hadSystemSuspension = previousReasons.some(
      (reason) => reason === 'screen_locked' || reason === 'system_sleep'
    )

    // Preserve manual pauses and Pomodoro breaks. A lock/sleep event must not
    // erase their reason, and clearing the system event must not leave Tempo
    // permanently "paused" just because that was the temporary frozen state.
    if (systemReasons.length && !hadSystemSuspension) {
      this.trackingStateBeforeSystemSuspension = this.lastStatus.trackingState || null
    }
    const retainedReasons = previousReasons.filter(
      (reason) => reason !== 'screen_locked' && reason !== 'system_sleep'
    )
    const suspensionReasons = [...retainedReasons, ...systemReasons]
    const restoredState = this.trackingStateBeforeSystemSuspension
    const trackingState = systemReasons.length
      ? 'paused'
      : retainedReasons.includes('manual_pause')
        ? 'paused'
        : retainedReasons.includes('pomodoro_break') || retainedReasons.includes('long_break')
          ? 'break'
          : restoredState || this.lastStatus.trackingState

    if (!systemReasons.length) this.trackingStateBeforeSystemSuspension = null
    this.updateStatus({
      ...this.lastStatus,
      trackingState,
      suspensionReasons,
      suspendedAtMs: state.suspendedAtMs
    })
  }

  sendRecategorizeResult(result: { requestId: string; ok: boolean; message?: string }): void {
    this.send({ version: protocolVersion, type: 'recategorizeResult', ...result })
  }

  private canPresentDistractionNotice(notice: DistractionAttentionNotice): boolean {
    const status = this.lastStatus
    if (this.availability !== 'ready' || !status || status.showDistractionNotchAlerts === false) return false
    if (status.latestStatus !== 'unproductive') return false
    if (status.trackingState !== 'normal' && status.trackingState !== 'active') return false
    if ((status.suspensionReasons || []).length > 0) return false
    return Boolean(notice.eventId && status.eventIds?.includes(notice.eventId))
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
    return join(
      app.getAppPath(),
      'build-resources',
      'Tempo Notch Helper.app',
      'Contents',
      'MacOS',
      'Tempo Notch Helper'
    )
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
    if (event.type === 'openFocusGoal') {
      const window = this.mainWindow()
      window?.show()
      window?.focus()
      window?.webContents.send('tempo-desktop-command', 'start-focus')
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
