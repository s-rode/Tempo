import { ActiveWindowEvent, Category } from 'shared'
import type { ActivityToRecategorize } from '../App'
import { DisplayWindowInfo } from '../utils/distractionStatusBarUIHelpers'
import type { ForegroundActivityWindow } from '../lib/activityCaptureState'

export const useRecategorizationHandler = (
  latestEvent: ActiveWindowEvent | null | undefined,
  displayWindowInfo: DisplayWindowInfo | null,
  categoryDetails: unknown,
  onOpenRecategorizeDialog: (target: ActivityToRecategorize) => void,
  foreground?: ForegroundActivityWindow | null
) => {
  const handleOpenRecategorize = () => {
    if (!displayWindowInfo) return
    const event = latestEvent
    if (!event?.eventId && foreground?.monitoringCaptureId && foreground.type !== 'system') {
      // Opening or cancelling the chooser must not persist a neutral event
      // or interfere with an automatic classification already in flight.
      onOpenRecategorizeDialog({
        nameToDisplay: displayWindowInfo.title || displayWindowInfo.ownerName,
        eventIds: [],
        currentCategoryId: 'uncategorized',
        currentCategoryName: 'Not yet classified',
        foregroundCapture: foreground
      })
      return
    }
    if (!event?.eventId) return

    const currentCat = categoryDetails as Category | null
    const currentCatId = event.categoryId || 'uncategorized'
    const currentCatName = currentCat?.name || 'Uncategorized'

    const target: ActivityToRecategorize = {
      nameToDisplay:
        displayWindowInfo.ownerName +
        (displayWindowInfo.title ? ` - ${displayWindowInfo.title}` : ''),
      eventIds: [event.eventId],
      currentCategoryId: currentCatId,
      currentCategoryName: currentCatName
    }
    onOpenRecategorizeDialog(target)
  }

  return handleOpenRecategorize
}
