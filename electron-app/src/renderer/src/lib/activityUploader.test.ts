import { expect, test } from 'bun:test'
import { MAX_ACTIVITY_CONTENT_CHARACTERS } from 'shared'
import { uploadActiveWindowEvent } from './activityUploader'

test('uploads a long Firefox OCR capture without exceeding the real API content limit', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => (key === 'tempoLocalMode' ? 'true' : null) }
  })
  try {
    const rawOcr = 'Lecture notes '.repeat(600).slice(0, 7000)
    let submitted = 0
    const result = await uploadActiveWindowEvent(
      'test-token',
      {
        ownerName: 'Firefox',
        title: 'Lecture notes',
        type: 'browser',
        browser: 'firefox',
        contentSource: 'ocr',
        contentCaptureStatus: 'captured',
        content: rawOcr,
        monitoringCaptureId: 'capture-test',
        timestamp: 123
      },
      async (payload) => {
        expect(payload.content.length).toBeLessThanOrEqual(MAX_ACTIVITY_CONTENT_CHARACTERS)
        expect(payload.content).toBe(rawOcr.slice(0, MAX_ACTIVITY_CONTENT_CHARACTERS))
        expect(payload.ownerName).toBe('Firefox')
        expect(payload.monitoringCaptureId).toBe('capture-test')
        submitted++
        return { eventId: 'saved-firefox' }
      }
    )
    expect(submitted).toBe(1)
    expect(result?.eventId).toBe('saved-firefox')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
