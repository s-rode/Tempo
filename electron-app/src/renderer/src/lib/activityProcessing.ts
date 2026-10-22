import { ActiveWindowEvent, Category as SharedCategory } from 'shared'
import type { ProcessedEventBlock } from '../components/DashboardView'
import { extractWebsiteInfo } from './activityByCategoryWidgetHelpers'

export interface ActivityItem {
  name: string
  ownerName?: string
  durationMs: number
  itemType: 'app' | 'website'
  identifier: string
  originalUrl?: string
  eventIds: string[]
  summary?: string
  reasoning?: string
}

export interface ProcessedCategory {
  id: string
  name: string
  color: string
  isProductive: boolean
  totalDurationMs: number
  activities: ActivityItem[]
}

const detailsForBlock = (block: ProcessedEventBlock) => {
  const event: ActiveWindowEvent = block.originalEvent
  if (event.url) {
    const website = extractWebsiteInfo(event.url, event.title || event.ownerName)
    return {
      itemType: 'website' as const,
      identifier: block.activityKey,
      originalUrl: event.url,
      name: block.activityLabel || website.name
    }
  }
  if (event.type === 'browser' || event.browser === 'firefox') {
    return {
      itemType: 'website' as const,
      identifier: block.activityKey,
      originalUrl: undefined,
      name: block.activityLabel || event.title || event.ownerName
    }
  }
  return {
    itemType: 'app' as const,
    identifier: block.activityKey,
    originalUrl: undefined,
    name: block.activityLabel || event.ownerName
  }
}

export const processActivityEvents = (
  processedBlocks: ProcessedEventBlock[],
  categoriesMap: Map<string, SharedCategory>
): ProcessedCategory[] => {
  const accumulator: Record<string, { category: SharedCategory; activities: ActivityItem[] }> = {}

  for (const block of processedBlocks) {
    if (!block.categoryId || block.durationMs <= 0) continue
    const category = categoriesMap.get(block.categoryId)
    if (!category) continue
    if (!accumulator[block.categoryId]) accumulator[block.categoryId] = { category, activities: [] }
    const details = detailsForBlock(block)
    accumulator[block.categoryId].activities.push({
      ...details,
      ownerName: block.originalEvent.ownerName,
      durationMs: block.durationMs,
      eventIds: block.eventIds,
      summary: block.activitySummary,
      reasoning: block.categoryReasoning
    })
  }

  return Object.values(accumulator).map(({ category, activities }) => ({
    id: category._id,
    name: category.name,
    color: category.color,
    isProductive: category.isProductive,
    totalDurationMs: activities.reduce((total, activity) => total + activity.durationMs, 0),
    activities: activities.sort((a, b) => b.durationMs - a.durationMs)
  }))
}
