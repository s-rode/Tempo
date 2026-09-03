import { describe, expect, test } from 'bun:test'
import { ActiveWindowEvent, Category } from 'shared'
import { deriveFocusPhaseTimerState, deriveNotchTimerState } from './notchTimerState'

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
    expect(state.productiveClock.runningSinceMs).toBe(11_000)
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

  test('never reconnects a short interruption to an unrelated older productive run', () => {
    const state = deriveNotchTimerState(
      [
        event(1_000, 'work'),
        event(181_000, 'play'),
        event(241_000, 'work'), // a separate older three-minute run
        event(421_000, 'play'),
        event(481_000, 'work'), // current eight-minute run begins here
        event(961_000, 'play'),
        event(991_000, 'work')
      ],
      categories,
      0,
      0,
      1_111_000
    )

    expect(state.currentStatus).toBe('productive')
    // 480 seconds before the interruption plus 120 seconds after it.
    expect(state.productiveStreakMs).toBe(600_000)
    expect(state.productiveClock.runningSinceMs).toBe(991_000)
  })

  test('treats a system lock as an immediate hard boundary', () => {
    const lock = {
      ...event(11_000, null),
      ownerName: 'System Lock',
      title: 'Screen was locked',
      type: 'system'
    } as ActiveWindowEvent
    const unlock = {
      ...event(111_000, null),
      ownerName: 'System Unlock',
      title: 'Screen was unlocked',
      type: 'system'
    } as ActiveWindowEvent
    const state = deriveNotchTimerState(
      [event(1_000, 'work'), lock, unlock, event(121_000, 'work')],
      categories,
      0,
      0,
      131_000
    )
    expect(state.productiveStreakMs).toBe(10_000)
    expect(state.productiveClock.runningSinceMs).toBe(121_000)
  })

  test('keeps both counters cumulative during a manual work phase', () => {
    const state = deriveFocusPhaseTimerState(
      [event(1_000, 'work'), event(11_000, 'play'), event(31_000, 'work')],
      categories,
      1_000,
      0,
      0,
      true,
      41_000
    )
    expect(state.productiveStreakMs).toBe(20_000)
    expect(state.distractedStreakMs).toBe(20_000)
    expect(state.productiveClock.runningSinceMs).toBe(31_000)
  })

  test('freezes a manual work phase clock while tracking is suspended', () => {
    const state = deriveFocusPhaseTimerState(
      [event(1_000, 'work')], categories, 1_000, 0, 0, false, 31_000
    )
    expect(state.productiveStreakMs).toBe(0)
    expect(state.productiveClock.runningSinceMs).toBeNull()
  })
})
