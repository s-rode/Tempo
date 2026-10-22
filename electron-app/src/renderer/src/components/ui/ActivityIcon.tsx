import AppIcon from '../AppIcon'
import { SYSTEM_EVENT_NAMES } from '../../lib/constants'

interface ActivityIconProps {
  url?: string | null
  appName?: string | null
  size: number
  className?: string
  itemType?: 'website' | 'app' | 'other'
  color?: string
  onFaviconError?: () => void
  showFallback?: boolean
  fallbackText?: string
}

/** All icon evidence stays on this Mac; websites never cause favicon requests. */
export function ActivityIcon({
  appName,
  size,
  className = '',
  itemType,
  color,
  showFallback,
  fallbackText
}: ActivityIconProps) {
  if (
    appName &&
    [
      ...SYSTEM_EVENT_NAMES,
      '💤 System Inactive',
      '⏰ System Active',
      '🔒 Screen Locked',
      '🔓 Screen Unlocked'
    ].includes(appName)
  )
    return <span style={{ width: size, height: size }} className={`shrink-0 ${className}`} />
  if (appName && itemType !== 'other' && !showFallback)
    return <AppIcon appName={appName} size={size} className={className} />
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ${className}`}
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.45 }}
    >
      {fallbackText?.slice(0, 1).toLocaleUpperCase() || '•'}
    </span>
  )
}
