import type { ActivityToRecategorize } from '../App'

/** Accept the existing object/JSON IPC forms, always targeting exact event IDs. */
export function recategorizeRequest(input: unknown): ActivityToRecategorize | null {
  let value = input
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const request = value as Record<string, unknown>
  if (
    typeof request._id !== 'string' || !request._id ||
    typeof request.name !== 'string' || !request.name ||
    !Array.isArray(request.eventIds) || request.eventIds.length === 0 ||
    request.eventIds.some((id) => typeof id !== 'string' || !id)
  ) return null
  return {
    nameToDisplay: typeof request.activityName === 'string' && request.activityName
      ? request.activityName : request.name,
    eventIds: request.eventIds,
    currentCategoryId: request._id,
    currentCategoryName: request.name
  }
}
