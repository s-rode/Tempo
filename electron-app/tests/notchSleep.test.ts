import { expect, test, mock } from 'bun:test'
mock.module('electron', () => ({ app: {}, BrowserWindow: class {} }))
const { NotchHelper } = await import('../src/main/notchHelper')

test('late renderer updates cannot reopen clocks during sleep or reuse the last activity on wake', () => {
  const helper = new NotchHelper(() => null)
  const status = { latestStatus: 'unproductive' as const, dailyProductiveMs: 0, dailyUnproductiveMs: 0,
    eventIds: ['before-sleep'], trackingState: 'normal' as const,
    distractedClock: { accumulatedMs: 5000, runningSinceMs: 1000 } }
  helper.updateStatus(status)
  helper.setSystemSuspension({ sleeping: true, locked: false, suspendedAtMs: 11000 })
  helper.updateStatus(status)
  expect((helper as any).lastStatus.distractedClock).toEqual({ accumulatedMs: 15000, runningSinceMs: null })
  expect((helper as any).lastStatus.trackingState).toBe('paused')
  helper.setSystemSuspension({ sleeping: false, locked: false, suspendedAtMs: null })
  helper.updateStatus(status)
  expect((helper as any).lastStatus.distractedClock.runningSinceMs).toBeNull()
  helper.updateStatus({ ...status, eventIds: ['after-wake'], distractedClock: { accumulatedMs: 15000, runningSinceMs: 54011000 } })
  expect((helper as any).lastStatus.distractedClock.runningSinceMs).toBe(54011000)
})
