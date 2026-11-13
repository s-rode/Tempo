/**
 * Coalesces refreshes of the (potentially multi-MB) activity timeline queries.
 * Every capture used to refetch the whole week; now bursts collapse into at
 * most one refetch per interval, and nothing is fetched while the window is
 * hidden (the pending refresh runs as soon as it becomes visible again).
 */
const MIN_INTERVAL_MS = 5_000

let lastRunAt = 0
let timer: ReturnType<typeof setTimeout> | null = null
let dirty = false
let pendingInvalidate: (() => void) | null = null
let listening = false

function run(): void {
  timer = null
  if (!dirty || !pendingInvalidate) return
  dirty = false
  lastRunAt = Date.now()
  pendingInvalidate()
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible' && dirty) schedule(0)
}

function schedule(delayMs: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(run, delayMs)
}

export function requestEventsRefresh(invalidate: () => void): void {
  pendingInvalidate = invalidate
  dirty = true
  if (!listening && typeof document !== 'undefined') {
    listening = true
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  if (timer) return
  schedule(Math.max(0, lastRunAt + MIN_INTERVAL_MS - Date.now()))
}

/** Test helper. */
export function resetEventsRefreshForTests(): void {
  if (timer) clearTimeout(timer)
  timer = null
  dirty = false
  lastRunAt = 0
  pendingInvalidate = null
}
