/** Refresh only authentication fields; activity text and other input stay unchanged. */
export function retrySessionRequest(
  inputUrl: string,
  options: RequestInit,
  oldToken: string,
  newToken: string
): { url: string; options: RequestInit } {
  const replace = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(replace)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, key === 'token' && item === oldToken ? newToken : replace(item)
    ]))
  }
  const url = new URL(inputUrl)
  const query = url.searchParams.get('input')
  if (query !== null) url.searchParams.set('input', JSON.stringify(replace(JSON.parse(query))))
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${newToken}`)
  return {
    url: url.toString(),
    options: {
      ...options,
      headers,
      body: typeof options.body === 'string'
        ? JSON.stringify(replace(JSON.parse(options.body))) : options.body
    }
  }
}
