import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { SettingsRow, SettingsSection } from './SettingsLayout'

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
      setStatus(
        Object.fromEntries(permissions.map(({ type }, index) => [type, Number(values[index])]))
      )
      setError(null)
    } catch {
      if (active.current)
        setError('Permission status is unavailable. Try again when Tempo is ready.')
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
    <SettingsSection
      title="Permissions"
      description="Both are optional. macOS manages Browser Automation access when Chrome or Safari capture is used, and asks for Apple Reminders access after you connect."
      actions={
        <Button variant="glass" size="compact" onClick={() => void refresh()}>
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      }
      footer={
        error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )
      }
    >
      {!enabled && (
        <SettingsRow
          title="Permission requests"
          description="Tempo asks for access only after you allow explicit requests."
          control={
            <Button
              variant="glass"
              size="compact"
              onClick={async () => {
                try {
                  await window.api.forceEnablePermissionRequests()
                  await refresh()
                } catch {
                  setError('Permission requests could not be enabled.')
                }
              }}
            >
              Allow requests
            </Button>
          }
        />
      )}
      {permissions.map(({ type, name, description }) => {
        const granted = status[type] === 1
        return (
          <SettingsRow
            key={type}
            title={name}
            description={description}
            control={
              <>
                <span className="tempo-pref-status" data-granted={granted || undefined}>
                  {status[type] === undefined ? 'Checking…' : granted ? 'Allowed' : 'Not allowed'}
                </span>
                {!granted && enabled && (
                  <Button
                    size="compact"
                    variant="glass"
                    disabled={pending !== null}
                    onClick={() => void request(type)}
                  >
                    {pending === type ? 'Waiting…' : 'Request…'}
                  </Button>
                )}
              </>
            }
          />
        )
      })}
    </SettingsSection>
  )
}
