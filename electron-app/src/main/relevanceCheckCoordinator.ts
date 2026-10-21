export interface RelevanceEpisode {
  key: string
  eventId: string
  application: string
}
/** One event-driven timer per continuous opaque episode; captures never renew its start. */
export class RelevanceCheckCoordinator {
  private current: RelevanceEpisode | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private delivered = false
  constructor(
    private deliver: (episode: RelevanceEpisode) => void,
    private schedule: (
      callback: () => void,
      ms: number
    ) => ReturnType<typeof setTimeout> = setTimeout,
    private cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout
  ) {}
  update(episode: RelevanceEpisode | null): void {
    if (episode && this.current?.key === episode.key) {
      this.current = episode
      return
    }
    if (this.timer) this.cancel(this.timer)
    this.timer = null
    this.current = episode
    this.delivered = false
    if (!episode) return
    this.timer = this.schedule(() => {
      this.timer = null
      if (this.current && !this.delivered) {
        this.delivered = true
        this.deliver(this.current)
      }
    }, 120_000)
  }
}
