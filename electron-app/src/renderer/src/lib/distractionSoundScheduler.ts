import { clampDistractionSoundInterval, type DistractionSoundPermit } from 'shared'

export function canPlayDistractionSound(
  enabled: boolean,
  trackingActive: boolean,
  isProductive: boolean | null | undefined,
  status?: string
): boolean {
  return (
    enabled &&
    trackingActive &&
    isProductive === false &&
    [
      'ollama',
      'manual',
      'manual_rule',
      'policy_override',
      'history',
      'navigation_cache',
      'deterministic_direct'
    ].includes(status || '')
  )
}

/** One recurring deadline, cancelled immediately when the verdict becomes uncertain. */
export class DistractionSoundScheduler {
  private eligible = false
  private intervalMs = 30_000
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private claim: (intervalMs: number) => Promise<DistractionSoundPermit>,
    private play: () => void,
    private schedule: (
      callback: () => void,
      delayMs: number
    ) => ReturnType<typeof setTimeout> = (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    private cancel: (timer: ReturnType<typeof setTimeout>) => void = (timer) => globalThis.clearTimeout(timer)
  ) {}

  update(eligible: boolean, intervalMs: number): void {
    const interval = clampDistractionSoundInterval(intervalMs)
    if (this.eligible === eligible && this.intervalMs === interval) return
    this.dispose()
    this.eligible = eligible
    this.intervalMs = interval
    if (eligible) this.scheduleNext(0, this.generation)
  }

  dispose(): void {
    this.generation++
    this.eligible = false
    if (this.timer !== null) this.cancel(this.timer)
    this.timer = null
  }

  private scheduleNext(delayMs: number, generation: number): void {
    this.timer = this.schedule(() => {
      this.timer = null
      void this.tick(generation)
    }, delayMs)
  }

  private async tick(generation: number): Promise<void> {
    if (!this.eligible || generation !== this.generation) return
    try {
      const permit = await this.claim(this.intervalMs)
      if (!this.eligible || generation !== this.generation) return
      if (permit.allowed) this.play()
      this.scheduleNext(
        permit.allowed ? this.intervalMs : Math.max(250, permit.retryAfterMs),
        generation
      )
    } catch {
      if (this.eligible && generation === this.generation)
        this.scheduleNext(this.intervalMs, generation)
    }
  }
}
