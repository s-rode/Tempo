import { describe, expect, test } from 'bun:test'
import { clampDistractionSoundInterval } from 'shared'
import { DistractionSoundGate } from '../src/main/distractionSoundGate'
import {
  canPlayDistractionSound,
  DistractionSoundScheduler
} from '../src/renderer/src/lib/distractionSoundScheduler'

function harness() {
  let now = 0,
    id = 0
  const jobs = new Map<number, { at: number; callback: () => void }>()
  const sounds: number[] = []
  const gate = new DistractionSoundGate()
  const scheduler = () =>
    new DistractionSoundScheduler(
      async (interval) => gate.claim(interval, now),
      () => sounds.push(now),
      (callback, delay) => {
        const key = ++id
        jobs.set(key, { at: now + delay, callback })
        return key as any
      },
      (key) => {
        jobs.delete(key as any)
      }
    )
  const advance = async (target: number) => {
    for (;;) {
      const next = [...jobs.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (!next || next[1].at > target) break
      now = next[1].at
      jobs.delete(next[0])
      next[1].callback()
      await Promise.resolve()
      await Promise.resolve()
    }
    now = target
  }
  return { sounds, scheduler, advance }
}

describe('distraction sound timing', () => {
  test('Firefox pending/distracted transitions every ten seconds cannot reset a thirty-second cooldown', async () => {
    const clock = harness(),
      scheduler = clock.scheduler()
    scheduler.update(true, 30_000)
    await clock.advance(0)
    for (let i = 1; i <= 9; i++) {
      await clock.advance(i * 10_000 - 1_000)
      scheduler.update(false, 30_000)
      await clock.advance(i * 10_000)
      scheduler.update(true, 30_000)
      await clock.advance(i * 10_000)
    }
    expect(clock.sounds).toEqual([0, 30_000, 60_000, 90_000])
    scheduler.dispose()
  })

  test('an unchanged distracted page still repeats at the configured interval', async () => {
    const clock = harness(),
      scheduler = clock.scheduler()
    scheduler.update(true, 30_000)
    await clock.advance(95_000)
    expect(clock.sounds).toEqual([0, 30_000, 60_000, 90_000])
    scheduler.dispose()
  })

  test('renderer remounts and multiple controllers share one cooldown', async () => {
    const clock = harness(),
      first = clock.scheduler()
    first.update(true, 30_000)
    await clock.advance(10_000)
    first.dispose()
    const second = clock.scheduler(),
      duplicate = clock.scheduler()
    second.update(true, 30_000)
    duplicate.update(true, 30_000)
    await clock.advance(60_000)
    expect(clock.sounds).toEqual([0, 30_000, 60_000])
    second.dispose()
    duplicate.dispose()
  })

  test('silences uncertainty, failures, productive activity, disabled sounds, and paused monitoring', () => {
    expect(canPlayDistractionSound(true, true, false, 'ollama')).toBe(true)
    for (const status of [
      'insufficient_context',
      'ollama_unavailable',
      'invalid_response',
      'ocr_unavailable'
    ])
      expect(canPlayDistractionSound(true, true, false, status)).toBe(false)
    expect(canPlayDistractionSound(true, true, true, 'ollama')).toBe(false)
    expect(canPlayDistractionSound(true, true, undefined)).toBe(false)
    expect(canPlayDistractionSound(false, true, false, 'manual')).toBe(false)
    expect(canPlayDistractionSound(true, false, false, 'manual')).toBe(false)
  })

  test('a stale asynchronous sound permission cannot play after activity becomes uncertain', async () => {
    let resolve!: (permit: { allowed: boolean; retryAfterMs: number }) => void
    let callback: () => void = () => {},
      played = 0
    const scheduler = new DistractionSoundScheduler(
      () =>
        new Promise((done) => {
          resolve = done
        }),
      () => {
        played++
      },
      (fn) => {
        callback = fn
        return 1 as any
      },
      () => {}
    )
    scheduler.update(true, 30_000)
    callback()
    scheduler.update(false, 30_000)
    resolve({ allowed: true, retryAfterMs: 30_000 })
    await Promise.resolve()
    expect(played).toBe(0)
  })

  test('interval changes apply against the last sound rather than restarting immediate playback', async () => {
    const clock = harness(),
      scheduler = clock.scheduler()
    scheduler.update(true, 30_000)
    await clock.advance(10_000)
    scheduler.update(true, 60_000)
    await clock.advance(59_999)
    expect(clock.sounds).toEqual([0])
    await clock.advance(60_000)
    expect(clock.sounds).toEqual([0, 60_000])
    scheduler.dispose()
    expect(clampDistractionSoundInterval(NaN)).toBe(30_000)
    expect(clampDistractionSoundInterval(5_000)).toBe(5_000)
    expect(clampDistractionSoundInterval(999_999)).toBe(300_000)
  })
})


test('default browser timers retain the Window receiver when invoked by the scheduler', () => {
  const originalSchedule = globalThis.setTimeout
  const originalCancel = globalThis.clearTimeout
  let scheduled = 0, cancelled = 0
  try {
    globalThis.setTimeout = function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      scheduled++
      return 1 as any
    } as any
    globalThis.clearTimeout = function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      cancelled++
    } as any
    const scheduler = new DistractionSoundScheduler(async () => ({ allowed: true, retryAfterMs: 0 }), () => {})
    scheduler.update(true, 30_000)
    scheduler.dispose()
    expect(scheduled).toBe(1)
    expect(cancelled).toBe(1)
  } finally {
    globalThis.setTimeout = originalSchedule
    globalThis.clearTimeout = originalCancel
  }
})
