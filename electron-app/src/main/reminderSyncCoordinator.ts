import type { ReminderPermission, ReminderSnapshot } from '../../../shared/reminders'

interface SyncState {
  enabled: boolean
}
interface SyncUpdate {
  enabled: boolean
  permission: ReminderPermission
  error?: 'fetch_failed' | 'permission_denied' | null
  snapshot?: ReminderSnapshot
}
interface Dependencies {
  readState: () => Promise<SyncState>
  writeState: (update: SyncUpdate) => Promise<void>
  permission: () => ReminderPermission
  requestAccess: () => Promise<ReminderPermission>
  fetch: () => Promise<ReminderSnapshot>
  observe: (callback: () => void) => void
  changed: () => void
}

/** Main-process owner; user actions supersede in-flight fetches immediately. */
export class ReminderSyncCoordinator {
  private tail: Promise<unknown> = Promise.resolve()
  private generation = 0
  private refreshVersion = 0
  private observing = false
  private stopped = false
  private debounce: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly deps: Dependencies) {}

  private enqueue(work: () => Promise<void>): Promise<void> {
    const result = this.tail.then(work)
    this.tail = result.catch(() => {})
    return result
  }
  private observe(): void {
    if (this.observing) return
    this.observing = true
    this.deps.observe(() => {
      clearTimeout(this.debounce)
      this.debounce = setTimeout(() => {
        void this.refresh().catch(() => {})
      }, 400)
    })
  }
  private async sync(generation: number, refreshVersion: number): Promise<void> {
    const state = await this.deps.readState()
    if (!state.enabled || this.stopped || generation !== this.generation || refreshVersion !== this.refreshVersion) return
    const permission = this.deps.permission()
    if (permission !== 'granted') {
      await this.deps.writeState({ enabled: true, permission, error: 'permission_denied' })
      this.deps.changed()
      return
    }
    this.observe()
    let update: SyncUpdate
    try {
      update = { enabled: true, permission, snapshot: await this.deps.fetch(), error: null }
    } catch {
      const currentPermission = this.deps.permission()
      update = {
        enabled: true,
        permission: currentPermission,
        error: currentPermission === 'granted' ? 'fetch_failed' : 'permission_denied'
      }
    }
    if (this.stopped || generation !== this.generation || refreshVersion !== this.refreshVersion) return
    // Recheck permission after the asynchronous fetch, before accepting data.
    if (this.deps.permission() !== 'granted')
      update = { enabled: true, permission: this.deps.permission(), error: 'permission_denied' }
    await this.deps.writeState(update)
    this.deps.changed()
  }
  public refresh(): Promise<void> {
    const generation = this.generation
    const refreshVersion = ++this.refreshVersion
    return this.enqueue(() => this.sync(generation, refreshVersion))
  }
  public connect(): Promise<void> {
    const generation = ++this.generation
    return this.enqueue(async () => {
      const permission =
        this.deps.permission() === 'not_determined'
          ? await this.deps.requestAccess()
          : this.deps.permission()
      if (generation !== this.generation || this.stopped) return
      const state = await this.deps.readState()
      await this.deps.writeState({
        enabled: permission === 'granted' || state.enabled,
        permission,
        error: permission === 'granted' ? null : 'permission_denied'
      })
      this.deps.changed()
      if (permission === 'granted') await this.sync(generation, this.refreshVersion)
      else
        throw new Error(
          'Allow Tempo in System Settings → Privacy & Security → Reminders, then reconnect.'
        )
    })
  }
  public disconnect(): Promise<void> {
    ++this.generation
    return this.enqueue(async () => {
      await this.deps.writeState({
        enabled: false,
        permission: this.deps.permission(),
        error: null
      })
      this.deps.changed()
    })
  }
  public stop(): void {
    this.stopped = true
    ++this.generation
    clearTimeout(this.debounce)
  }
}
