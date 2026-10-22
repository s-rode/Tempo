import { ActiveWindowEvent, Category } from 'shared'
import { generateProcessedEventBlocks } from './eventProcessing'

interface ProductivityMetrics {
  dailyProductiveMs: number
  dailyUnproductiveMs: number
}

export function calculateProductivityMetrics(
  events: ActiveWindowEvent[],
  categories: Category[]
): ProductivityMetrics {
  let dailyProductiveMs = 0
  let dailyUnproductiveMs = 0

  if (!events || !categories || events.length === 0 || categories.length === 0) {
    return { dailyProductiveMs, dailyUnproductiveMs }
  }

  const categoriesMap = new Map(categories.map((cat) => [cat._id, cat]))
  const processedBlocks = generateProcessedEventBlocks(events, categories)

  for (const block of processedBlocks) {
    if (block.categoryId) {
      const category = categoriesMap.get(block.categoryId)
      if (category) {
        if (category.isProductive) {
          dailyProductiveMs += block.durationMs
        } else {
          dailyUnproductiveMs += block.durationMs
        }
      }
    }
  }

  return { dailyProductiveMs, dailyUnproductiveMs }
}
