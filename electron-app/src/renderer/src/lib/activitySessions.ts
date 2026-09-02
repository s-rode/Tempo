import type { ProcessedEventBlock } from '../components/DashboardView'

const SESSION_GAP_MS = 2 * 60 * 1000
const SHORT_PRODUCTIVE_BLOCK_MS = 30 * 1000
const FIREFOX_CAPTURE_DUPLICATE_WINDOW_MS = 5 * 1000
const TRACKING_QUERY_KEYS = new Set(['gclid', 'fbclid', 'mc_cid', 'mc_eid'])

export interface BriefActivity {
  label: string
  durationMs: number
  eventIds: string[]
}

export interface ActivitySessionBlock {
  id: string
  displayKey: string
  startTime: Date
  endTime: Date
  activeDurationMs: number
  categoryId: string
  categoryName?: string
  categoryColor?: string
  isProductive?: boolean
  ownerName: string
  browser?: 'chrome' | 'safari' | 'firefox' | null
  label: string
  summary?: string
  reasoning?: string
  title?: string
  url?: string
  eventIds: string[]
  briefActivities: BriefActivity[]
  classificationStatus?: ProcessedEventBlock['classificationStatus']
  sourceBlocks: ProcessedEventBlock[]
}

export interface DayActivitySummary {
  displayKey: string
  label: string
  ownerName: string
  categoryIds: string[]
  totalDurationMs: number
  sessionIds: string[]
  sessions: ActivitySessionBlock[]
}

const normalize = (value?: string): string =>
  (value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s+(mozilla firefox|google chrome|safari)$/i, '')
    .trim()

const canonicalUrl = (value?: string): string | null => {
  if (!value) return null
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_') || TRACKING_QUERY_KEYS.has(key)) url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return value
  }
}

export const displayKeyForBlock = (block: ProcessedEventBlock): string => {
  const browser = block.originalEvent.browser
  if (browser === 'firefox') return `firefox:${normalize(block.title || block.activityLabel)}`
  if (browser === 'chrome' || browser === 'safari') {
    return `${browser}:${canonicalUrl(block.url) || normalize(block.title || block.activityLabel)}`
  }
  // Native applications often change their window title for every document, card,
  // or view. A continuous RemNote/IDE session should therefore remain one readable
  // block; browser pages retain their more specific page identity above.
  return `app:${normalize(block.ownerName)}`
}

const isFirefoxGenericCapture = (block: ProcessedEventBlock): boolean =>
  block.ownerName === 'Firefox' && block.originalEvent.browser !== 'firefox'

const isFirefoxPageCapture = (block: ProcessedEventBlock): boolean =>
  block.ownerName === 'Firefox' && block.originalEvent.browser === 'firefox'

const removeHistoricalFirefoxCaptureDuplicates = (blocks: ProcessedEventBlock[]): ProcessedEventBlock[] =>
  blocks.filter((block) => {
    if (!isFirefoxGenericCapture(block)) return true
    return !blocks.some(
      (candidate) =>
        isFirefoxPageCapture(candidate) &&
        Math.abs(candidate.startTime.getTime() - block.startTime.getTime()) <=
          FIREFOX_CAPTURE_DUPLICATE_WINDOW_MS
    )
  })

const statusIsManual = (status?: string): boolean => status === 'manual' || status === 'manual_rule'

const canMerge = (session: ActivitySessionBlock, block: ProcessedEventBlock): boolean =>
  session.displayKey === displayKeyForBlock(block) &&
  session.categoryId === block.categoryId &&
  block.startTime.getTime() - session.endTime.getTime() <= SESSION_GAP_MS

const makeSession = (block: ProcessedEventBlock): ActivitySessionBlock => ({
  id: `${displayKeyForBlock(block)}:${block.startTime.getTime()}`,
  displayKey: displayKeyForBlock(block),
  startTime: block.startTime,
  endTime: block.endTime,
  activeDurationMs: block.durationMs,
  categoryId: block.categoryId || '',
  categoryName: block.categoryName,
  categoryColor: block.categoryColor,
  isProductive: block.isProductive,
  ownerName: block.ownerName,
  browser: block.originalEvent.browser,
  label: block.activityLabel || block.title || block.ownerName,
  summary: block.activitySummary,
  reasoning: block.categoryReasoning,
  title: block.title,
  url: block.url,
  eventIds: [...block.eventIds],
  briefActivities: [],
  classificationStatus: block.classificationStatus,
  sourceBlocks: [block]
})

const mergeIntoSession = (session: ActivitySessionBlock, block: ProcessedEventBlock): void => {
  session.endTime = block.endTime
  session.activeDurationMs += block.durationMs
  session.eventIds.push(...block.eventIds)
  session.sourceBlocks.push(block)

  const currentPrimaryDuration = Math.max(...session.sourceBlocks.slice(0, -1).map((item) => item.durationMs))
  const nextIsManual = statusIsManual(block.classificationStatus)
  const currentIsManual = statusIsManual(session.classificationStatus)
  if ((nextIsManual && !currentIsManual) || (!currentIsManual && block.durationMs > currentPrimaryDuration)) {
    session.label = block.activityLabel || block.title || block.ownerName
    session.summary = block.activitySummary
    session.reasoning = block.categoryReasoning
    session.title = block.title
    session.url = block.url
    session.classificationStatus = block.classificationStatus
  }
}

const canFold = (session: ActivitySessionBlock): boolean =>
  session.isProductive === true &&
  session.activeDurationMs < SHORT_PRODUCTIVE_BLOCK_MS &&
  !statusIsManual(session.classificationStatus)

const foldBriefProductiveSessions = (sessions: ActivitySessionBlock[]): ActivitySessionBlock[] => {
  const folded = new Set<number>()

  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index]
    if (!canFold(session)) continue
    const previous = sessions[index - 1]
    const next = sessions[index + 1]
    const candidates = [previous, next].filter(
      (candidate): candidate is ActivitySessionBlock =>
        !!candidate &&
        !folded.has(sessions.indexOf(candidate)) &&
        candidate.isProductive === true &&
        candidate.categoryId === session.categoryId &&
        !statusIsManual(candidate.classificationStatus)
    )
    if (!candidates.length) continue

    const target =
      candidates.find((candidate) => candidate.displayKey === session.displayKey) ||
      candidates.sort((left, right) => right.activeDurationMs - left.activeDurationMs)[0]
    target.activeDurationMs += session.activeDurationMs
    target.eventIds.push(...session.eventIds)
    target.briefActivities.push({
      label: session.label,
      durationMs: session.activeDurationMs,
      eventIds: session.eventIds
    })
    folded.add(index)
  }

  return sessions.filter((_, index) => !folded.has(index))
}

export const buildActivitySessions = (blocks: ProcessedEventBlock[]): ActivitySessionBlock[] => {
  const sorted = removeHistoricalFirefoxCaptureDuplicates(blocks)
    .filter((block) => !!block.categoryId && block.durationMs > 0)
    .sort((left, right) => left.startTime.getTime() - right.startTime.getTime())
  const sessions: ActivitySessionBlock[] = []

  for (const block of sorted) {
    const openSession = sessions[sessions.length - 1]
    if (openSession && canMerge(openSession, block)) mergeIntoSession(openSession, block)
    else sessions.push(makeSession(block))
  }
  return foldBriefProductiveSessions(sessions)
}

export const buildDayActivitySummaries = (sessions: ActivitySessionBlock[]): DayActivitySummary[] => {
  const summaries = new Map<string, DayActivitySummary>()
  for (const session of sessions) {
    const existing = summaries.get(session.displayKey)
    if (existing) {
      existing.totalDurationMs += session.activeDurationMs
      existing.sessionIds.push(session.id)
      existing.sessions.push(session)
      if (!existing.categoryIds.includes(session.categoryId)) existing.categoryIds.push(session.categoryId)
    } else {
      summaries.set(session.displayKey, {
        displayKey: session.displayKey,
        label: session.label,
        ownerName: session.ownerName,
        categoryIds: [session.categoryId],
        totalDurationMs: session.activeDurationMs,
        sessionIds: [session.id],
        sessions: [session]
      })
    }
  }
  return [...summaries.values()].sort((left, right) => right.totalDurationMs - left.totalDurationMs)
}

export const sessionTotals = (sessions: ActivitySessionBlock[]) =>
  sessions.reduce(
    (totals, session) => {
      if (session.isProductive === true) totals.focusedMs += session.activeDurationMs
      else if (session.isProductive === false) totals.distractedMs += session.activeDurationMs
      else totals.uncertainMs += session.activeDurationMs
      return totals
    },
    { focusedMs: 0, distractedMs: 0, uncertainMs: 0 }
  )
