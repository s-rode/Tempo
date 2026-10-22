import { describe, expect, test } from 'bun:test'
import {
  clampDistractionReminderInterval,
  DistractionReminderGate,
  MAX_DISTRACTION_REMINDER_INTERVAL_MS,
  MIN_DISTRACTION_REMINDER_INTERVAL_MS
} from '../src/main/distractionNoticePolicy'

describe('distraction reminder delivery gate', () => {
  test('clamps the renderer-supplied repeat interval to Tempo’s supported range', () => {
    expect(clampDistractionReminderInterval(1)).toBe(MIN_DISTRACTION_REMINDER_INTERVAL_MS)
    expect(clampDistractionReminderInterval(120_000)).toBe(120_000)
    expect(clampDistractionReminderInterval(9_000_000)).toBe(MAX_DISTRACTION_REMINDER_INTERVAL_MS)
  })

  test('suppresses duplicate delivery for one active event but allows a new event', () => {
    const gate = new DistractionReminderGate()
    const interval = 60_000

    expect(gate.shouldDeliver('event-a', interval, 1_000)).toBe(true)
    expect(gate.shouldDeliver('event-a', interval, 30_000)).toBe(false)
    expect(gate.shouldDeliver('event-b', interval, 30_000)).toBe(true)
    expect(gate.shouldDeliver('event-a', interval, 61_000)).toBe(true)
  })
})
