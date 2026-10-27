import { describe, expect, test } from 'bun:test'
import {
  distractionNotificationCopy,
  distractionNotificationIntervalMs,
  MIN_DISRUPTION_NOTIFICATION_INTERVAL_MS
} from './distractionNudge'

describe('distraction notification copy', () => {
  test('never schedules distraction notifications more often than once a minute', () => {
    expect(distractionNotificationIntervalMs(30)).toBe(MIN_DISRUPTION_NOTIFICATION_INTERVAL_MS)
    expect(distractionNotificationIntervalMs(60)).toBe(60_000)
    expect(distractionNotificationIntervalMs(120)).toBe(120_000)
  })

  test('uses direct local-model copy when it is available', () => {
    expect(
      distractionNotificationCopy(
        {
          ownerName: 'Instagram',
          title: 'Instagram',
          activityLabel: null,
          nudgeTitle: 'Close Instagram',
          nudgeBody: 'This scrolling is borrowing time from your exam prep. Open your notes now.'
        },
        'Prepare for the machine learning exam'
      )
    ).toEqual({
      title: 'Close Instagram',
      body: 'This scrolling is borrowing time from your exam prep. Open your notes now.'
    })
  })

  test('replaces legacy generic copy with a useful, goal-aware fallback', () => {
    const copy = distractionNotificationCopy(
      {
        ownerName: 'ChatGPT',
        title: 'ChatGPT',
        activityLabel: 'Distracted by ChatGPT',
        nudgeTitle: 'Return to: Study',
        nudgeBody: 'ChatGPT is currently marked as distracting. Distraction: Distracting'
      },
      'Finish the statistical learning problem set'
    )
    expect(copy.title).toBe('Close ChatGPT')
    expect(copy.body).toContain('Finish the statistical learning problem set')
    expect(copy.body).toContain('take the next useful step now')
  })
})

describe('on-demand notification preparation', () => {
  test('coalesces calls and remembers unavailable-model fallback for the activity', async () => {
    const { DistractionNudgeLoader } = await import('./distractionNudge')
    const loader = new DistractionNudgeLoader()
    let calls = 0
    const prepare = async () => { calls++; throw new Error('offline') }
    await Promise.all([loader.load('event:goal', prepare), loader.load('event:goal', prepare)])
    expect(await loader.load('event:goal', prepare)).toEqual({ copy: null })
    expect(calls).toBe(1)
    await loader.load('event:new-goal', prepare)
    expect(calls).toBe(2)
  })

  test('preserves a server veto instead of turning stale activity into a fallback alert', async () => {
    const { DistractionNudgeLoader } = await import('./distractionNudge')
    expect(await new DistractionNudgeLoader().load('old-event', async () => null)).toBeNull()
  })
})
