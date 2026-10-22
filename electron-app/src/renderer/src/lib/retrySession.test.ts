import { expect, test } from 'bun:test'
import { retrySessionRequest } from './retrySession'

test('expired batched query tokens are refreshed without changing activity or goal text', () => {
  const url = new URL('http://127.0.0.1:3301/trpc/user.getUser,goals.getDailyPlan?batch=1')
  url.searchParams.set('input', JSON.stringify({
    0: { token: 'old-session' },
    1: { token: 'old-session', goal: 'old-session', dateKey: '2026-10-22' }
  }))
  const retry = retrySessionRequest(url.toString(), { headers: { 'X-Check': 'retained' } }, 'old-session', 'new-session')
  const payload = JSON.parse(new URL(retry.url).searchParams.get('input')!)
  expect(payload[0].token).toBe('new-session')
  expect(payload[1]).toEqual({ token: 'new-session', goal: 'old-session', dateKey: '2026-10-22' })
  expect(new Headers(retry.options.headers).get('Authorization')).toBe('Bearer new-session')
  expect(new Headers(retry.options.headers).get('X-Check')).toBe('retained')
})

test('a mutation retry keeps its correction identity and exact-event scope', () => {
  const original = { 0: { token: 'old-session', actionId: 'correction-1', eventIds: ['event-1'], title: 'Synthetic task' } }
  const retry = retrySessionRequest('http://127.0.0.1:3301/trpc/activeWindowEvents.recategorizeBlock?batch=1', {
    method: 'POST', body: JSON.stringify(original)
  }, 'old-session', 'new-session')
  expect(JSON.parse(retry.options.body as string)).toEqual({ 0: { ...original[0], token: 'new-session' } })
  expect(retry.options.method).toBe('POST')
})
