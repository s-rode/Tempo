import { ActiveWindowEvent, Category } from 'shared'
import type { ProcessedEventBlock } from '../components/DashboardView'
import { SYSTEM_EVENT_NAMES } from '../lib/constants'

const BLOCK_IDLE_GAP_MS = 2 * 60 * 1000
// A real uninterrupted study visit can last well beyond the old five-minute
// ceiling. Four hours still prevents legacy/missed sleep boundaries from
// turning an overnight inactive gap into a full day of tracked time.
export const MAX_CONTINUOUS_ACTIVITY_MS = 4 * 60 * 60 * 1000

const activityKey = (event: ActiveWindowEvent): string =>
  event.activityKey || `${event.browser || 'app'}:${event.ownerName}:${event.title || ''}`

export function generateProcessedEventBlocks(
  events: ActiveWindowEvent[],
  categories: Category[]
): ProcessedEventBlock[] {
  const sorted = [...events]
    .filter((event) => typeof event.timestamp === 'number')
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
  const categoriesMap = new Map<string, Category>(categories.map((category) => [category._id, category]))
  const blocks: ProcessedEventBlock[] = []
  let openBlock: ProcessedEventBlock | null = null

  for (let index = 0; index < sorted.length; index += 1) {
    const event = sorted[index]
    const startTime = new Date(event.timestamp as number)
    const nextTimestamp = sorted[index + 1]?.timestamp as number | undefined
    const durationMs = Math.max(
      0,
      Math.min(
        nextTimestamp === undefined ? Date.now() - startTime.getTime() : nextTimestamp - startTime.getTime(),
        MAX_CONTINUOUS_ACTIVITY_MS
      )
    )
    const endTime = new Date(startTime.getTime() + durationMs)

    if (SYSTEM_EVENT_NAMES.includes(event.ownerName)) {
      openBlock = null
      continue
    }

    const category = event.categoryId ? categoriesMap.get(event.categoryId) : undefined
    const categoryId = event.categoryId || '__uncertain__'
    const key = activityKey(event)
    const canMerge =
      openBlock &&
      openBlock.activityKey === key &&
      openBlock.categoryId === categoryId &&
      startTime.getTime() - openBlock.endTime.getTime() <= BLOCK_IDLE_GAP_MS

    if (canMerge && openBlock) {
      openBlock.endTime = endTime
      openBlock.durationMs += durationMs
      openBlock.eventIds.push(...(event.eventId ? [event.eventId] : []))
      openBlock.originalEvent = event
      openBlock.title = event.title
      openBlock.activityLabel = event.activityLabel || openBlock.activityLabel
      openBlock.activitySummary = event.activitySummary || openBlock.activitySummary
      openBlock.categoryReasoning = event.categoryReasoning || openBlock.categoryReasoning
      openBlock.classificationStatus = event.classificationStatus || openBlock.classificationStatus
      continue
    }

    openBlock = {
      startTime,
      endTime,
      durationMs,
      name: event.activityLabel || event.title || event.ownerName,
      ownerName: event.ownerName,
      title: event.title,
      url: event.url || undefined,
      activityKey: key,
      activityLabel: event.activityLabel || event.title || event.ownerName,
      activitySummary: event.activitySummary || undefined,
      categoryReasoning: event.categoryReasoning || undefined,
      classificationStatus: event.classificationStatus,
      categoryId,
      categoryName: category?.name || 'Uncertain',
      categoryColor: category?.color || '#d97706',
      isProductive: category ? category.isProductive : undefined,
      eventIds: event.eventId ? [event.eventId] : [],
      originalEvent: event
    }
    blocks.push(openBlock)
  }
  return blocks
}
