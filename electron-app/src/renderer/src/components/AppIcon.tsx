import { useEffect, useState } from 'react'

const icons = new Map<string, Promise<string | null>>()

export default function AppIcon({
  appName,
  iconPath,
  size = 24,
  className = ''
}: {
  appName: string
  iconPath?: string | null
  size?: number
  className?: string
}) {
  const [source, setSource] = useState<string | null>(iconPath || null)
  useEffect(() => {
    let active = true
    if (!icons.has(appName)) {
      icons.set(
        appName,
        window.api.getAppIconDataUrl(appName).catch(() => null)
      )
    }
    void icons.get(appName)!.then((value) => {
      if (active) setSource(value)
    })
    return () => {
      active = false
    }
  }, [appName])
  return source ? (
    <img
      src={source}
      alt={`${appName} icon`}
      width={size}
      height={size}
      className={`rounded-sm ${className}`}
      onError={() => setSource(null)}
    />
  ) : (
    <span
      title={appName}
      aria-label={appName}
      className={`inline-flex shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground font-medium ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {appName.slice(0, 1).toLocaleUpperCase()}
    </span>
  )
}
