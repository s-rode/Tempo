let endpoint = 'http://127.0.0.1:3001'

export function configureServerConnection(value: string): void {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Tempo requires a local HTTP server.')
  }
  endpoint = url.origin
}

export const localServerUrl = (): string => endpoint
