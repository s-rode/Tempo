export const SYSTEM_EVENT_LABELS = {
  'System Sleep': { ownerName: '💤 System Inactive', title: 'Computer was sleeping' },
  'System Wake': { ownerName: '⏰ System Active', title: 'Computer woke from sleep' },
  'System Lock': { ownerName: '🔒 Screen Locked', title: 'Screen was locked' },
  'System Unlock': { ownerName: '🔓 Screen Unlocked', title: 'Screen was unlocked' }
} as const satisfies Record<string, { ownerName: string; title: string }>

export type SystemEventName = keyof typeof SYSTEM_EVENT_LABELS

export const SYSTEM_EVENT_NAMES: string[] = Object.keys(SYSTEM_EVENT_LABELS)

export const isSystemEventName = (name: string | null | undefined): name is SystemEventName =>
  typeof name === 'string' && Object.prototype.hasOwnProperty.call(SYSTEM_EVENT_LABELS, name)

export const MAX_GAP_BETWEEN_EVENTS_MS = 5 * 60 * 1000
export const REFRESH_EVENTS_INTERVAL_MS = 30000 // 30 seconds
