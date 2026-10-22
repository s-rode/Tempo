import { describe, expect, test } from 'bun:test'
import { recategorizeRequest } from './recategorizeRequest'

describe('native recategorization request compatibility', () => {
  const request = { _id: 'work', name: 'Work', activityName: 'Synthetic editor', eventIds: ['event-1'] }
  test('object and JSON deliveries retain the same exact target', () => {
    const target = recategorizeRequest(request)
    expect(target?.eventIds).toEqual(['event-1'])
    expect(target?.nameToDisplay).toBe('Synthetic editor')
    expect(recategorizeRequest(JSON.stringify(request))).toEqual(target)
  })
  test('a missing display label falls back to the category label', () => {
    expect(recategorizeRequest({ ...request, activityName: undefined })?.nameToDisplay).toBe('Work')
  })
  test('malformed or broad requests cannot open an exact-event correction', () => {
    for (const invalid of [null, '{broken', {}, { ...request, eventIds: [] },
      { ...request, eventIds: ['event-1', null] }, { ...request, _id: '' }]) {
      expect(recategorizeRequest(invalid)).toBeNull()
    }
  })
})
