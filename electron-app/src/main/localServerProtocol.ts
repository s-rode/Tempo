/** Must match the local server's packaged API revision. */
export const TEMPO_LOCAL_SERVER_API_VERSION = '2026-10-contextual-classifier-v2'

export interface LocalServerHealth {
  service?: string
  database?: string
  apiVersion?: string
  processId?: number
  ownerProcessId?: number | null
}

export function isCompatibleOwnedServer(
  health: LocalServerHealth | null,
  expectedApiVersion: string,
  ownerProcessId: number
): boolean {
  return (
    health?.service === 'tempo-local-server' &&
    health.database === 'ready' &&
    health.apiVersion === expectedApiVersion &&
    health.ownerProcessId === ownerProcessId
  )
}
