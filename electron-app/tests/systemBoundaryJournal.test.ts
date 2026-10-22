import { expect, test } from 'bun:test'
import { SystemBoundaryJournal, type SystemBoundary } from '../src/main/systemBoundaryJournal'
import { freezeNotchClocks } from '../src/main/freezeNotchClocks'

test('sleep is durable before delivery; offline sleep and wake replay in order with original identities', async () => {
  let disk: SystemBoundary[] = [], online = false
  const delivered: SystemBoundary[] = []
  const journal = new SystemBoundaryJournal([], rows => { disk = structuredClone(rows) }, async row => {
    expect(disk[0]).toEqual(row)
    if (!online) throw new Error('offline')
    delivered.push(row)
  })
  const sleep: SystemBoundary = { captureId: 'sleep', kind: 'sleep', timestamp: 1000 }
  journal.enqueue(sleep)
  await journal.flush()
  expect(disk).toEqual([sleep])
  // Simulate process exit and wake after fifteen hours, with renderer absent.
  online = true
  const restored = new SystemBoundaryJournal(disk, rows => { disk = structuredClone(rows) }, async row => { delivered.push(row) })
  restored.enqueue({ captureId: 'wake', kind: 'wake', timestamp: 54_001_000 })
  await Promise.resolve()
  await restored.flush()
  expect(delivered.map(x => x.kind)).toEqual(['sleep', 'wake'])
  expect(delivered[0]).toEqual(sleep)
  expect(disk).toEqual([])
})

test('wake never resurrects a pre-sleep clock or charges the overnight interval', () => {
  const frozen = freezeNotchClocks({ latestStatus: 'unproductive', dailyProductiveMs: 0, dailyUnproductiveMs: 0,
    distractedClock: { accumulatedMs: 5000, runningSinceMs: 1000 },
    dailyUnproductiveClock: { accumulatedMs: 15000, runningSinceMs: 1000 } }, 11_000)
  expect(frozen.distractedClock).toEqual({ accumulatedMs: 15_000, runningSinceMs: null })
  const awake = freezeNotchClocks(frozen, 54_011_000)
  expect(awake.distractedClock).toEqual(frozen.distractedClock)
  expect(awake.dailyUnproductiveClock).toEqual({ accumulatedMs: 25_000, runningSinceMs: null })
})
