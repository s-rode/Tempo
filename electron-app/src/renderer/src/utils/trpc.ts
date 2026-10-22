import { httpBatchLink } from '@trpc/client'
import { createTRPCReact } from '@trpc/react-query'
import type { AppRouter } from '../../../../../server/src/index'
import { localServerUrl } from '../lib/serverConnection'
import { refreshAccessToken } from '../lib/auth'
import { retrySessionRequest } from '../lib/retrySession'
export type { AppRouter }

export const trpc = createTRPCReact<AppRouter>()
let refreshInFlight: Promise<string> | null = null

async function renewedToken(previous: string): Promise<string> {
  const current = localStorage.getItem('accessToken')
  if (current && current !== previous) return current
  if (!refreshInFlight) {
    const pending = refreshAccessToken()
    refreshInFlight = pending
    void pending.finally(() => {
      if (refreshInFlight === pending) refreshInFlight = null
    }).catch(() => {})
  }
  return refreshInFlight
}

export const createTrpcClient = () => trpc.createClient({
  links: [httpBatchLink({
    url: `${localServerUrl()}/trpc`,
    headers: () => ({ Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}` }),
    fetch: async (url, options = {}) => {
      const previous = new Headers(options.headers).get('Authorization')?.replace(/^Bearer /, '') || ''
      const response = await fetch(url, options)
      // Retry only a fully unauthorized batch. Replaying a mixed successful
      // mutation batch could execute an already successful action twice.
      if (response.status !== 401 || !previous) return response
      const token = await renewedToken(previous)
      const retry = retrySessionRequest(url.toString(), options, previous, token)
      return fetch(retry.url, retry.options)
    }
  })]
})
