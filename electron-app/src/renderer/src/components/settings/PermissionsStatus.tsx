import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

const permissions = [
  {
    type: 0,
    name: 'Accessibility',
    description: 'Optional fallback for window titles. Tempo does not read native app body text.'
  },
  {
    type: 2,
    name: 'Screen Recording',
    description: 'Optional Firefox OCR fallback. Restart Tempo after granting access if macOS asks.'
  }
] as const

export function PermissionsStatus() {
  const [status, setStatus] = useState<Record<number, number>>({})
  const [enabled, setEnabled] = useState(false)
  const [pending, setPending] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const active = useRef(false)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)
  const refresh = useCallback(async () => {
    try {
      const [requestsEnabled, ...values] = await Promise.all([
        window.api.getPermissionRequestStatus(),
        ...permissions.map(({ type }) => window.api.getPermissionStatus(type))
      ])
      if (!active.current) return
      setEnabled(Boolean(requestsEnabled))
      setStatus(Object.fromEntries(permissions.map(({ type }, index) => [type, Number(values[index])])))
      setError(null)
    } catch {
      if (active.current) setError('Permission status is unavailable. Try again when Tempo is ready.')
    }
  }, [])
  useEffect(() => {
    active.current = true
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      active.current = false
      window.removeEventListener('focus', onFocus)
      if (poll.current) clearInterval(poll.current)
    }
  }, [refresh])

  const request = async (type: number) => {
    if (pending !== null) return
    setPending(type)
    try {
      await window.api.requestPermission(type)
      if (!active.current) return
      let attempts = 0
      // Only an explicit request starts polling. Unmount, grant or the bounded
      // deadline clears it; normal settings display has no periodic work.
      poll.current = setInterval(async () => {
        attempts++
        try {
          const value = await window.api.getPermissionStatus(type)
          if (!active.current) return
          setStatus((old) => ({ ...old, [type]: value }))
          if (value === 1 || attempts >= 30) {
            if (poll.current) clearInterval(poll.current)
            poll.current = null
            setPending(null)
          }
        } catch {
          if (poll.current) clearInterval(poll.current)
          poll.current = null
          if (active.current) {
            setPending(null)
            setError('Open System Settings → Privacy & Security to review access.')
          }
        }
      }, 2000)
    } catch {
      if (active.current) {
        setPending(null)
        setError('Tempo could not request access. Review permissions in System Settings.')
      }
    }
  }
  return (
    <Card>
      <CardHeader><CardTitle>Permissions</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          These permissions are optional. Browser Automation access is managed by macOS when
          Chrome or Safari capture is used. Apple Reminders access is requested after Connect.
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!enabled && (
          <Button variant="outline" onClick={async () => {
            try {
              await window.api.forceEnablePermissionRequests()
              await refresh()
            } catch { setError('Permission requests could not be enabled.') }
          }}>Enable explicit requests</Button>
        )}
        {permissions.map(({ type, name, description }) => (
          <div key={type} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1 basis-48">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{name}</span>
                <Badge variant="secondary">
                  {status[type] === undefined ? 'Checking…' : status[type] === 1 ? 'Granted' : 'Optional'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
            {status[type] !== 1 && enabled && (
              <Button size="sm" variant="outline" disabled={pending !== null}
                onClick={() => void request(type)}>
                {pending === type ? 'Waiting…' : 'Request access'}
              </Button>
            )}
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => void refresh()}>Refresh status</Button>
      </CardContent>
    </Card>
  )
}
