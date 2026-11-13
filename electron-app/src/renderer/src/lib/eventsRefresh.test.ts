import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { requestEventsRefresh, resetEventsRefreshForTests } from './eventsRefresh'

describe('requestEventsRefresh', () => {
  beforeEach(() => {
    ;(globalThis as any).document = {
      visibilityState: 'visible',
      addEventListener: () => {}
    }
    resetEventsRefreshForTests()
  })
  afterEach(() => resetEventsRefreshForTests())

  it('coalesces a burst of requests into one invalidation', async () => {
    let calls = 0
    for (let i = 0; i < 10; i += 1) requestEventsRefresh(() => (calls += 1))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(calls).toBe(1)
  })

  it('does not invalidate while the window is hidden', async () => {
    ;(globalThis as any).document.visibilityState = 'hidden'
    let calls = 0
    requestEventsRefresh(() => (calls += 1))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(calls).toBe(0)
  })
})
