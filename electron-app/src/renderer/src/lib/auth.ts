import { createTRPCProxyClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../../../../../server/src/index'
import { localServerUrl } from './serverConnection'

export async function refreshAccessToken(): Promise<string> {
  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken) throw new Error('No local refresh session is available.')
  const client = createTRPCProxyClient<AppRouter>({
    links: [httpBatchLink({ url: `${localServerUrl()}/trpc` })]
  })
  try {
    const response = await client.auth.refreshToken.mutate({ refreshToken })
    const previous = localStorage.getItem('accessToken')
    localStorage.setItem('accessToken', response.accessToken)
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'accessToken', oldValue: previous, newValue: response.accessToken,
      storageArea: localStorage
    }))
    return response.accessToken
  } catch (error) {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    throw error
  }
}
