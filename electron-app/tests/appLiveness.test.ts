import { expect, test } from 'bun:test'
import { boundaryForUncleanExit, parseLivenessMarker, stopBoundary } from '../src/main/appLiveness'

const id = () => 'id'

test('a clean launch leaves nothing to close', () => {
  expect(boundaryForUncleanExit(parseLivenessMarker(null), 5_000, id)).toBeNull()
})

test('a marker left by a quit, shutdown or crash closes the session at the last heartbeat', () => {
  const marker = parseLivenessMarker(JSON.stringify({ aliveAtMs: 1_000 }))
  expect(boundaryForUncleanExit(marker, 50_000_000, id)).toEqual({
    captureId: 'id',
    kind: 'stop',
    timestamp: 1_000
  })
})

test('a marker from a clock ahead of now never closes the session in the future', () => {
  const marker = parseLivenessMarker(JSON.stringify({ aliveAtMs: 9_000 }))
  expect(boundaryForUncleanExit(marker, 2_000, id)?.timestamp).toBe(2_000)
})

test('an unreadable marker is ignored', () => {
  expect(parseLivenessMarker('{')).toBeNull()
  expect(parseLivenessMarker(JSON.stringify({ aliveAtMs: 'soon' }))).toBeNull()
  expect(parseLivenessMarker(JSON.stringify({ aliveAtMs: -1 }))).toBeNull()
})

test('quitting closes the session now', () => {
  expect(stopBoundary(7_000, id)).toEqual({ captureId: 'id', kind: 'stop', timestamp: 7_000 })
})
