import { describe, expect, jest, test } from 'bun:test'
import type { ReminderPermission, ReminderSnapshot } from '../../shared/reminders'
import { ReminderSyncCoordinator } from '../src/main/reminderSyncCoordinator'

function setup(enabled = false) {
  let permission: ReminderPermission = 'granted'
  const updates: any[] = []
  const snapshot: ReminderSnapshot = { lists: [], reminders: [] }
  const deps = {
    readState: jest.fn(async () => ({ enabled })),
    writeState: jest.fn(async (update: any) => {
      updates.push(update)
      enabled = update.enabled
    }),
    permission: () => permission,
    requestAccess: jest.fn(async () => {
      permission = 'granted'
      return permission
    }),
    fetch: jest.fn(async () => snapshot),
    observe: jest.fn(),
    changed: jest.fn()
  }
  return {
    coordinator: new ReminderSyncCoordinator(deps),
    deps,
    updates,
    setPermission: (value: ReminderPermission) => {
      permission = value
    }
  }
}
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('main-process reminder synchronization', () => {
  test('activation during the permission prompt cannot cancel explicit connection', async () => {
    const { coordinator, deps, updates, setPermission } = setup()
    setPermission('not_determined')
    const prompted = deferred<void>()
    const permission = deferred<ReminderPermission>()
    deps.requestAccess.mockImplementationOnce(async () => { prompted.resolve(); return permission.promise })
    const connecting = coordinator.connect()
    await prompted.promise
    const activation = coordinator.refresh()
    setPermission('granted')
    permission.resolve('granted')
    await Promise.all([connecting, activation])
    expect(updates.some((update) => update.enabled)).toBe(true)
    expect(updates.at(-1).snapshot).toBeDefined()
  })
  test('disabled startup reads no reminders and never requests access', async () => {
    const { coordinator, deps } = setup()
    await coordinator.refresh()
    expect(deps.fetch).not.toHaveBeenCalled()
    expect(deps.requestAccess).not.toHaveBeenCalled()
    expect(deps.observe).not.toHaveBeenCalled()
  })
  test('only explicit connection requests undetermined permission and installs one observer', async () => {
    const { coordinator, deps, updates, setPermission } = setup()
    setPermission('not_determined')
    await coordinator.connect()
    await coordinator.refresh()
    expect(deps.requestAccess).toHaveBeenCalledTimes(1)
    expect(deps.observe).toHaveBeenCalledTimes(1)
    expect(updates.at(-1).snapshot).toEqual({ lists: [], reminders: [] })
  })
  test('failed fetch reports staleness without replacing a snapshot', async () => {
    const { coordinator, deps, updates } = setup(true)
    deps.fetch.mockRejectedValueOnce(new Error('unavailable'))
    await coordinator.refresh()
    expect(updates).toEqual([{ enabled: true, permission: 'granted', error: 'fetch_failed' }])
    await coordinator.refresh()
    expect(updates.at(-1).snapshot).toBeDefined()
  })
  test('revocation blocks reads and never prompts again', async () => {
    const { coordinator, deps, updates, setPermission } = setup(true)
    setPermission('denied')
    await coordinator.refresh()
    expect(deps.fetch).not.toHaveBeenCalled()
    expect(deps.requestAccess).not.toHaveBeenCalled()
    expect(updates[0]).toEqual({ enabled: true, permission: 'denied', error: 'permission_denied' })
  })
  test('disconnect supersedes an in-flight fetch without clearing cached source data', async () => {
    const { coordinator, deps, updates } = setup(true)
    const started = deferred<void>()
    const fetch = deferred<ReminderSnapshot>()
    deps.fetch.mockImplementationOnce(() => {
      started.resolve()
      return fetch.promise
    })
    const pending = coordinator.refresh()
    await started.promise
    const disconnect = coordinator.disconnect()
    fetch.resolve({ lists: [], reminders: [] })
    await Promise.all([pending, disconnect])
    expect(updates).toEqual([{ enabled: false, permission: 'granted', error: null }])
  })
  test('a newer refresh discards an obsolete result; fetches never overlap', async () => {
    const { coordinator, deps, updates } = setup(true)
    const started = deferred<void>()
    const first = deferred<ReminderSnapshot>()
    deps.fetch.mockImplementationOnce(() => {
      started.resolve()
      return first.promise
    })
    const old = coordinator.refresh()
    await started.promise
    const latest = coordinator.refresh()
    expect(deps.fetch).toHaveBeenCalledTimes(1)
    first.resolve({ lists: [{ id: 'obsolete', name: 'Old', accountName: '' }], reminders: [] })
    await Promise.all([old, latest])
    expect(updates).toHaveLength(1)
    expect(updates[0].snapshot).toEqual({ lists: [], reminders: [] })
  })
  test('permission revoked during fetch prevents the successful payload being accepted', async () => {
    const { coordinator, deps, updates, setPermission } = setup(true)
    deps.fetch.mockImplementationOnce(async () => {
      setPermission('denied')
      return { lists: [], reminders: [] }
    })
    await coordinator.refresh()
    expect(updates[0].snapshot).toBeUndefined()
    expect(updates[0].error).toBe('permission_denied')
  })
  test('stopping prevents late fetch results from being persisted', async () => {
    const { coordinator, deps, updates } = setup(true)
    const started = deferred<void>()
    const fetch = deferred<ReminderSnapshot>()
    deps.fetch.mockImplementationOnce(() => {
      started.resolve()
      return fetch.promise
    })
    const pending = coordinator.refresh()
    await started.promise
    coordinator.stop()
    fetch.resolve({ lists: [], reminders: [] })
    await pending
    expect(updates).toEqual([])
  })
})
