import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { ActiveWindowDetails } from 'shared/dist/types.js'
import { nativeWindows } from '../native-modules/native-windows'

export interface ActivityCaptureEnvelope {
  captureId: string
  sequence: number
  detectedAtMs: number
  committedAtMs: number
  details: ActiveWindowDetails
}

export interface MonitoringHealth {
  state: 'starting' | 'active' | 'paused' | 'degraded'
  lastNativeDetectionAtMs?: number
  lastDeliveredAtMs?: number
  pendingCaptureId?: string
  lastErrorCode?: string
  systemSuspension?: SystemSuspensionState
}

export interface SystemSuspensionState {
  locked: boolean
  sleeping: boolean
  suspendedAtMs: number | null
}

/**
 * Keeps native monitoring alive independently of the dashboard's visible
 * state. The renderer receives only the newest committed capture after it has
 * authenticated, so an old hidden/destroyed dashboard cannot freeze Kronus.
 */
export class ActivityMonitoringCoordinator {
  private sequence = 0
  private latestCapture: ActivityCaptureEnvelope | null = null
  private rendererReady = false
  private paused = false
  private started = false
  private health: MonitoringHealth = { state: 'starting' }
  private systemSuspension: SystemSuspensionState = { locked: false, sleeping: false, suspendedAtMs: null }

  constructor(
    private readonly getMainWindow: () => BrowserWindow | null,
    private readonly onSystemSuspensionChange?: (state: SystemSuspensionState) => void
  ) {}

  start(): void {
    if (this.started) return
    this.started = true
    nativeWindows.startActiveWindowObserver((details) => this.onNativeActivity(details))
    this.health = { state: this.paused ? 'paused' : 'active' }
  }

  stop(): void {
    if (!this.started) return
    nativeWindows.stopActiveWindowObserver()
    this.started = false
    this.rendererReady = false
    this.health = { state: 'starting' }
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    nativeWindows.setActivityCapturePaused(paused)
    this.health = { ...this.health, state: paused ? 'paused' : 'active' }
  }

  markRendererReady(): void {
    this.rendererReady = true
    this.deliverLatest()
  }

  acknowledge(captureId: string): void {
    if (this.latestCapture?.captureId === captureId) {
      this.health = { ...this.health, pendingCaptureId: undefined }
    }
  }

  getHealth(): MonitoringHealth {
    return { ...this.health, systemSuspension: { ...this.systemSuspension } }
  }

  restart(): boolean {
    if (this.paused) return false
    try {
      const rendererWasReady = this.rendererReady
      this.stop()
      this.start()
      this.rendererReady = rendererWasReady
      // Native refresh uses the normal stability path, avoiding an immediate
      // expensive capture while the frontmost application is still changing.
      nativeWindows.refreshActiveWindow()
      return true
    } catch {
      this.health = { ...this.health, state: 'degraded', lastErrorCode: 'observer_restart_failed' }
      return false
    }
  }

  private onNativeActivity(details: ActiveWindowDetails | null): void {
    if (!details) return
    const now = Date.now()
    this.updateSystemSuspension(details, now)
    const envelope: ActivityCaptureEnvelope = {
      captureId: randomUUID(),
      sequence: ++this.sequence,
      detectedAtMs: details.timestamp || now,
      committedAtMs: now,
      details
    }
    this.latestCapture = envelope
    this.health = {
      state: this.paused || this.systemSuspension.locked || this.systemSuspension.sleeping ? 'paused' : 'active',
      lastNativeDetectionAtMs: now,
      pendingCaptureId: envelope.captureId
    }
    this.deliverLatest()
  }

  private updateSystemSuspension(details: ActiveWindowDetails, now: number): void {
    if (details.type !== 'system') return
    const text = `${details.ownerName || ''} ${details.title || ''}`.toLowerCase()
    const next = { ...this.systemSuspension }
    if (text.includes('unlock')) next.locked = false
    else if (text.includes('wake')) next.sleeping = false
    else if (text.includes('sleep')) next.sleeping = true
    else if (text.includes('lock')) next.locked = true
    else return
    next.suspendedAtMs = next.locked || next.sleeping ? this.systemSuspension.suspendedAtMs ?? now : null
    this.systemSuspension = next
    this.onSystemSuspensionChange?.(next)
  }

  private deliverLatest(): void {
    const window = this.getMainWindow()
    if (!this.rendererReady || !this.latestCapture || !window || window.isDestroyed()) return
    window.webContents.send('activity-capture', this.latestCapture)
    this.health = { ...this.health, lastDeliveredAtMs: Date.now() }
  }
}
