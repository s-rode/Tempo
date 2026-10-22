import { describe, expect, test } from 'bun:test'
import { TEMPO_LOCAL_SERVER_API_VERSION as SERVER_API_VERSION } from '../../shared/types'
import {
  isCompatibleOwnedServer,
  TEMPO_LOCAL_SERVER_API_VERSION,
  type LocalServerHealth
} from '../src/main/localServerProtocol'

const current: LocalServerHealth = {
  service: 'tempo-local-server',
  database: 'ready',
  apiVersion: 'current',
  processId: 42,
  ownerProcessId: 100
}

describe('local server ownership protocol', () => {
  test('keeps the packaged app and server revisions in sync', () => {
    expect(TEMPO_LOCAL_SERVER_API_VERSION).toBe(SERVER_API_VERSION)
  })

  test('reuses only the current server owned by this Electron process', () => {
    expect(isCompatibleOwnedServer(current, 'current', 100)).toBe(true)
  })

  test('rejects an orphan inherited from another app process', () => {
    expect(isCompatibleOwnedServer(current, 'current', 101)).toBe(false)
  })

  test('rejects old and unversioned server binaries', () => {
    expect(isCompatibleOwnedServer(current, 'next', 100)).toBe(false)
    expect(isCompatibleOwnedServer({ ...current, apiVersion: undefined }, 'current', 100)).toBe(
      false
    )
  })

  test('rejects unhealthy or unrelated listeners', () => {
    expect(isCompatibleOwnedServer({ ...current, database: 'unavailable' }, 'current', 100)).toBe(
      false
    )
    expect(isCompatibleOwnedServer({ ...current, service: 'other' }, 'current', 100)).toBe(false)
    expect(isCompatibleOwnedServer(null, 'current', 100)).toBe(false)
  })
})
