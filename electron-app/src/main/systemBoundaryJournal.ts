export type SystemBoundary = {
  captureId: string
  kind: 'sleep' | 'wake' | 'lock' | 'unlock'
  timestamp: number
}

/** Only OS boundaries are durable; window titles/content never enter this journal. */
export class SystemBoundaryJournal {
  private pending: SystemBoundary[]
  private flushing = false
  constructor(
    initial: SystemBoundary[],
    private readonly save: (pending: SystemBoundary[]) => void,
    private readonly deliver: (boundary: SystemBoundary) => Promise<unknown>
  ) { this.pending = initial }

  enqueue(boundary: SystemBoundary): void {
    this.pending.push(boundary)
    // Commit before starting any asynchronous work, including at will-sleep.
    this.save(this.pending)
    void this.flush()
  }

  async flush(): Promise<void> {
    if (this.flushing) return
    this.flushing = true
    try {
      while (this.pending.length) {
        await this.deliver(this.pending[0])
        this.pending.shift()
        this.save(this.pending)
      }
    } catch {
      // Retain the original timestamp and identity across sleep/server/restart.
    } finally { this.flushing = false }
  }
}
