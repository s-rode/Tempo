import { ActiveWindowDetails } from 'shared/dist/types.js'
import { SYSTEM_EVENT_NAMES } from './constants'
import { deleteLocalFile } from './localFiles'
import { boundedActivityContent } from './activityCaptureState'

// Define the type for the mutateAsync function we expect
interface MutateAsyncFunction {
  (variables: any): Promise<any>
}

// Define the event data type
interface EventData {
  token: string
  windowId?: number
  ownerName: string
  type: 'window' | 'browser' | 'system'
  browser?: 'chrome' | 'safari' | 'firefox' | null
  title: string
  url?: string | null
  content?: string | null
  contentSource?: 'dom' | 'ocr' | 'title' | null
  siteHost?: string | null
  siteIdentity?: string | null
  contentCaptureStatus?:
    | 'captured'
    | 'permission_denied'
    | 'capture_failed'
    | 'no_text'
    | 'navigation_pending'
    | null
  captureReason?:
    | 'app_switch'
    | 'periodic_backup'
    | 'firefox_activation'
    | 'firefox_tab_switch'
    | 'system_lock'
    | 'system_unlock'
    | 'system_sleep'
    | 'system_wake'
    | 'system_lock_initial'
    | null
  timestamp: number
  screenshotS3Url?: string
  navigationFingerprint?: string | null
  pageCorrectionKey?: string | null
  monitoringCaptureId?: string
  monitoringSequence?: number
}

export const uploadActiveWindowEvent = async (
  token: string,
  windowDetails: ActiveWindowDetails,
  mutateEvent: MutateAsyncFunction
): Promise<any | null> => {
  if (!token || !windowDetails) {
    console.log('Skipping event upload - missing token or details:', {
      token: !!token,
      details: !!windowDetails
    })
    return
  }

  const isSystemEvent = SYSTEM_EVENT_NAMES.includes(windowDetails.ownerName)

  // Map ActiveWindowDetails to the input type expected by the backend
  const eventData: EventData = {
    token,
    windowId: isSystemEvent ? 0 : windowDetails.windowId,
    ownerName: windowDetails.ownerName,
    type: isSystemEvent ? 'system' : windowDetails.type,
    browser: windowDetails.browser,
    title: windowDetails.title,
    url: windowDetails.url,
    // OCR can return more text than the API accepts. Bound it before transport,
    // including Unicode text, so long Firefox pages remain valid captures.
    content: boundedActivityContent(windowDetails.content),
    contentSource: windowDetails.contentSource,
    siteHost: windowDetails.siteHost,
    siteIdentity: windowDetails.siteIdentity,
    contentCaptureStatus: windowDetails.contentCaptureStatus,
    captureReason: windowDetails.captureReason,
    timestamp: windowDetails.timestamp || Date.now(),
    navigationFingerprint: windowDetails.navigationFingerprint ?? undefined,
    pageCorrectionKey: windowDetails.pageCorrectionKey ?? undefined,
    monitoringCaptureId: windowDetails.monitoringCaptureId,
    monitoringSequence: windowDetails.monitoringSequence
  }

  try {
    if (!isSystemEvent && windowDetails.localScreenshotPath) {
      await deleteLocalFile(windowDetails.localScreenshotPath)
    }

    // Upload the event data
    return await mutateEvent(eventData)
  } catch (error) {
    console.error('Error uploading active window event:')
    // Handle error appropriately, e.g., retry logic, user notification
    return null
  }
}
