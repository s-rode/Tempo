import { describe, expect, test } from 'bun:test'
import { ActiveWindowEvent, Category } from 'shared'
import { deriveNotchTimerState } from './notchTimerState'

const categories = [
  { _id: 'work', name: 'Work', isProductive: true },
  { _id: 'play', name: 'Distraction', isProductive: false }
] as Category[]

const event = (timestamp: number, categoryId: string | null): ActiveWindowEvent =>
  ({
    userId: 'local',
    ownerName: 'Firefox',
    type: 'browser',
    title: 'Test',
    timestamp,
    categoryId
  }) as ActiveWindowEvent

describe('deriveNotchTimerState', () => {
  test('keeps one productive streak across productive category samples', () => {
    const state = deriveNotchTimerState(
      [event(1_000, 'work'), event(11_000, 'work')],
      categories,
      20_000,
      0,
      31_000
    )
    expect(state.currentStatus).toBe('productive')
    expect(state.statusStartedAtMs).toBe(1_000)
    expect(state.productiveStreakMs).toBe(30_000)
    expect(state.productiveClock.runningSinceMs).toBe(1_000)
  })

  test('retains the completed productive streak when distraction begins', () => {
    const state = deriveNotchTimerState(
      [event(1_000, 'work'), event(11_000, 'play')],
      categories,
      10_000,
      10_000,
      21_000
    )
    expect(state.currentStatus).toBe('unproductive')
    expect(state.productiveStreakMs).toBe(10_000)
    expect(state.distractedStreakMs).toBe(10_000)
    expect(state.provisionalDistractionStartedAtMs).toBe(11_000)
  })

  test('freezes timers for uncertain activity', () => {
    const state = deriveNotchTimerState(
      [event(1_000, 'work'), event(11_000, null)],
      categories,
      10_000,
      0,
      21_000
    )
    expect(state.currentStatus).toBe('maybe')
    expect(state.statusStartedAtMs).toBeNull()
    expect(state.productiveStreakMs).toBe(10_000)
  })

  test('resumes focused time after a 59.999 second distraction without counting it', () => {
    const state = deriveNotchTimerState(
      [event(1_000, 'work'), event(11_000, 'play'), event(70_999, 'work')],
      categories,
      20_000,
      59_999,
      80_999
    )
    expect(state.currentStatus).toBe('productive')
    expect(state.productiveStreakMs).toBe(20_000)
    expect(state.productiveClock.runningSinceMs).toBe(70_999)
  })

  test('starts a fresh focused streak after a sixty-second distraction', () => {
    const state = deriveNotchTimerState(
      [event(1_000, 'work'), event(11_000, 'play'), event(71_000, 'work')],
      categories,
      20_000,
      60_000,
      81_000
    )
    expect(state.currentStatus).toBe('productive')
    expect(state.productiveStreakMs).toBe(10_000)
    expect(state.productiveClock.runningSinceMs).toBe(71_000)
  })
})
