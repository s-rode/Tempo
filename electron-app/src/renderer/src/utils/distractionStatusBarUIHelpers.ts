import { ActiveWindowDetails, ActiveWindowEvent, Category } from 'shared'
import type { ForegroundActivityWindow } from '../lib/activityCaptureState'

export interface DisplayWindowInfo {
  ownerName: string
  title: string
  url: string | undefined
  isApp: boolean
}

export const getIdentifierFromUrl = (url: string): string => {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.hostname
  } catch (e) {
    return url
  }
}

export const getDisplayWindowInfo = (
  latestEvent: ActiveWindowEvent | null | undefined,
  activeWindow: ActiveWindowDetails | null
): DisplayWindowInfo => {
  // A freshly detected window is more truthful than the previous classified
  // event. Its category is intentionally shown as pending until local
  // classification completes.
  const dw = activeWindow || latestEvent
  if (!dw) return { ownerName: 'No active application', title: '', url: undefined, isApp: true }

  // TODO: merge with or map from constants array?
  switch (dw.ownerName) {
    case 'System Sleep':
      return {
        ownerName: '💤 System Inactive',
        title: 'Computer was sleeping',
        url: undefined,
        isApp: true
      }
    case 'System Wake':
      return {
        ownerName: '⏰ System Active',
        title: 'Computer woke from sleep',
        url: undefined,
        isApp: true
      }
    case 'System Lock':
      return {
        ownerName: '🔒 Screen Locked',
        title: 'Screen was locked',
        url: undefined,
        isApp: true
      }
    case 'System Unlock':
      return {
        ownerName: '🔓 Screen Unlocked',
        title: 'Screen was unlocked',
        url: undefined,
        isApp: true
      }
    default:
      // Firefox has no URL by design, but its title + OCR fingerprint identifies
      // a website activity rather than one generic Firefox application.
      const isApp = !dw.url && dw.browser !== 'firefox'
      return {
        ownerName: dw.ownerName || 'Unknown App',
        title: dw.title && dw.title !== dw.ownerName ? dw.title : '',
        url: dw.url || undefined,
        isApp
      }
  }
}

function knownCategory(value: unknown): Category | null {
  return value && typeof value === 'object' && '_id' in value ? (value as Category) : null
}
export const getCardBgColor = (value: unknown): string => {
  const category = knownCategory(value)
  if (!category) return 'bg-muted/35 dark:bg-muted/20'
  return category.isProductive === true
    ? 'bg-blue-50 dark:bg-blue-900'
    : 'bg-red-50 dark:bg-red-900'
}
export const getStatusTextColor = (value: unknown): string => {
  const category = knownCategory(value)
  if (!category) return 'text-muted-foreground'
  return category.isProductive === true
    ? 'text-blue-700 dark:text-blue-200'
    : 'text-red-700 dark:text-red-200'
}

const isSameVisibleActivity = (
  latestEvent: ActiveWindowEvent | null | undefined,
  activeWindow: ActiveWindowDetails | null
): boolean =>
  Boolean(
    latestEvent &&
      activeWindow &&
      latestEvent.ownerName === activeWindow.ownerName &&
      latestEvent.title === activeWindow.title &&
      latestEvent.type === activeWindow.type &&
      latestEvent.browser === activeWindow.browser
  )

const statusForPersistedEvent = (latestEvent: ActiveWindowEvent): string | null => {
  if (latestEvent.classificationStatus === 'ollama_unavailable') return 'Local AI is unavailable'
  if (latestEvent.classificationStatus === 'invalid_response')
    return 'Local AI could not complete this comparison'
  if (latestEvent.classificationStatus === 'ocr_unavailable')
    return 'Firefox text capture is unavailable'
  if (latestEvent.classificationStatus === 'insufficient_context') return 'Needs more context'
  if (latestEvent.classificationStatus === 'policy_override')
    return 'Focused · learned from a similar correction'
  return null
}

export const getStatusText = (
  latestEvent: ActiveWindowEvent | null | undefined,
  activeWindow: ForegroundActivityWindow | null,
  categoryId: string | null | undefined,
  isLoadingCategory: boolean,
  isLoadingUserCategories: boolean,
  categoryDetails: unknown
): string => {
  if (!latestEvent && !activeWindow) return 'Waiting for activity...'
  if (activeWindow?.classificationFailed) return 'Could not classify this activity'
  // A failed event can still be the raw foreground window while the renderer
  // waits for its next capture. Prefer the truthful persisted failure over a
  // misleading permanent “Classifying…” label in that case.
  const persistedStatus = latestEvent ? statusForPersistedEvent(latestEvent) : null
  if (persistedStatus && isSameVisibleActivity(latestEvent, activeWindow)) return persistedStatus
  if (activeWindow?.contentCaptureStatus === 'navigation_pending') return 'Reading page…'
  if (activeWindow) return 'Comparing with your plan…'
  if (persistedStatus) return persistedStatus
  if (!categoryId) return 'Uncategorized'
  if (isLoadingCategory || isLoadingUserCategories) return 'Loading category...'

  if (!categoryDetails || typeof categoryDetails !== 'object' || !('_id' in categoryDetails)) {
    return categoryDetails === null ? 'Category not found' : 'Category unavailable'
  }

  const fullCategoryDetails = categoryDetails as Category
  if (fullCategoryDetails.isProductive === true) {
    if (latestEvent?.goalRelation === 'direct') return `${fullCategoryDetails.name}: Goal-related`
    if (latestEvent?.goalRelation === 'supporting')
      return `${fullCategoryDetails.name}: Supporting your task`
    return `${fullCategoryDetails.name}: Focused`
  }
  if (fullCategoryDetails.isProductive === false) return `${fullCategoryDetails.name}: Off goal`
  return `${fullCategoryDetails.name}: Neutral`
}
