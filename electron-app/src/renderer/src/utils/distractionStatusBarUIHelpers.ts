import { ActiveWindowDetails, ActiveWindowEvent, Category } from 'shared'
import type { ForegroundActivityWindow } from '../lib/activityCaptureState'
import { isSystemEventName, SYSTEM_EVENT_LABELS } from '../lib/constants'

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

  if (isSystemEventName(dw.ownerName)) {
    return { ...SYSTEM_EVENT_LABELS[dw.ownerName], url: undefined, isApp: true }
  }

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

function knownCategory(value: unknown): Category | null {
  return value && typeof value === 'object' && '_id' in value ? (value as Category) : null
}
/** Drives the tint of the current-activity card. */
export const getActivityState = (value: unknown): 'focused' | 'distracted' | 'unknown' => {
  const category = knownCategory(value)
  if (!category) return 'unknown'
  return category.isProductive === true ? 'focused' : 'distracted'
}
export const getStatusTextColor = (value: unknown): string => {
  const category = knownCategory(value)
  if (!category) return 'text-muted-foreground'
  return category.isProductive === true
    ? 'tempo-status-focused text-blue-700 dark:text-blue-200'
    : 'tempo-status-distracted text-red-700 dark:text-red-200'
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

// policy_override covers several local rules. Name the one that applied, so a
// tool-role decision is not presented as something the user taught Tempo.
const policyOverrideStatus = (basis: string | null | undefined): string => {
  if (basis === 'tool_role') return 'Focused · this tool fits the task’s method'
  if (basis === 'task_preference') return 'Focused · matches your correction for this task'
  if (basis === 'list_preference') return 'Focused · matches your corrections in this list'
  return 'Focused · learned from a similar correction'
}

const statusForPersistedEvent = (latestEvent: ActiveWindowEvent): string | null => {
  if (latestEvent.classificationStatus === 'ollama_unavailable') return 'Local AI is unavailable'
  if (latestEvent.classificationStatus === 'invalid_response')
    return 'Local AI could not complete this comparison'
  if (latestEvent.classificationStatus === 'ocr_unavailable')
    return 'Firefox text capture is unavailable'
  if (latestEvent.classificationStatus === 'insufficient_context') return 'Needs more context'
  if (latestEvent.classificationStatus === 'policy_override')
    return policyOverrideStatus(latestEvent.classificationBasis)
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
