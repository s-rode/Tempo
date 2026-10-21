import { describe, test, expect } from 'bun:test'
import { RelevanceCheckCoordinator } from '../src/main/relevanceCheckCoordinator'
describe('quiet relevance checks', () => {
  test('repeated captures keep the deadline and deliver the newest event once', () => {
    let callback: () => void = () => {}
    let schedules = 0
    const delivered: any[] = []
    const coordinator = new RelevanceCheckCoordinator(
      (e) => delivered.push(e),
      (fn, ms) => {
        expect(ms).toBe(120_000)
        callback = fn
        schedules++
        return 1 as any
      },
      () => {}
    )
    coordinator.update({ key: 'tool:task', eventId: 'one', application: 'Tool' })
    coordinator.update({ key: 'tool:task', eventId: 'two', application: 'Tool' })
    callback()
    callback()
    expect(schedules).toBe(1)
    expect(delivered.map((e) => e.eventId)).toEqual(['two'])
    coordinator.update({ key: 'tool:task', eventId: 'three', application: 'Tool' })
    expect(schedules).toBe(1)
  })
  test('pause and task/tool changes end an episode', () => {
    let cancelled = 0,
      schedules = 0
    const coordinator = new RelevanceCheckCoordinator(
      () => {},
      () => {
        schedules++
        return 1 as any
      },
      () => {
        cancelled++
      }
    )
    coordinator.update({ key: 'a', eventId: 'one', application: 'Tool' })
    coordinator.update(null)
    coordinator.update({ key: 'b', eventId: 'two', application: 'Tool' })
    expect(cancelled).toBe(1)
    expect(schedules).toBe(2)
  })
})
