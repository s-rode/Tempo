import type { FocusRun } from 'shared'
import type { ProcessedEventBlock } from '../components/DashboardView'
import { displayActivityLabel, displayActivitySummary } from './activityPresentation'

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
  totalDurationMs: number
  focusedMs: number
  distractedMs: number
  uncertainMs: number
  startTime: Date
  endTime: Date
  sessionIds: string[]
  sessions: ActivitySessionBlock[]
}

export interface TimelineChapter {
  id: string
  startTime: Date
  endTime: Date
  sessions: ActivitySessionBlock[]
  focusedMs: number
  distractedMs: number
  uncertainMs: number
  label: string
  summary?: string
  focusGoal?: TimelineFocusGoal
  boundaryReason?: string
}

/** A local, user-owned focus run returned solely for the daily timeline. */
export interface FocusTimelineRun {
  run: FocusRun
  endedAtMs: number | null
  outcome: 'completed' | 'cancelled' | null
}

export type FocusGoalAdherence =
  | 'on_track'
  | 'mostly_on_track'
  | 'interrupted'
  | 'mostly_uncertain'
  | 'not_enough_activity'

/**
 * A manual work-phase annotation. It intentionally reports classified
 * activity, not an assertion that Tempo can prove the user completed a goal.
 */
export interface TimelineFocusGoal {
  runId: string
  phaseId: string
  phaseIndex: number
  kind: 'custom' | 'pomodoro'
  goal: string
  startTime: Date
  endTime: Date
  focusedMs: number
  distractedMs: number
  uncertainMs: number
  observedMs: number
  focusRatio: number | null
  adherence: FocusGoalAdherence
  adherenceLabel: string
  isLead: boolean
  runIds?: string[]
}

/** A privacy-preserving, app-level view of a compact timeline chapter. */
export interface TimelineChapterAppUsage {
  appName: string
  durationMs: number
  sessionCount: number
}

export const TIMELINE_GAP_MS = 5 * 60 * 1000
const BRIEF_ACTIVITY_MS = 2 * 60 * 1000

/** Presentation boundaries follow recorded goals, sustained activity changes and gaps.
 * Splitting a session changes only its displayed slice; original events remain intact.
 */
export const buildTimelineChapters = (
  sessions: ActivitySessionBlock[],
  runs?: FocusTimelineRun[],
  nowMs = Date.now()
): TimelineChapter[] => {
  const candidates = focusGoalCandidates(runs || [], nowMs)
  const boundaries = [
    ...new Set(candidates.flatMap((goal) => [goal.startTime.getTime(), goal.endTime.getTime()]))
  ].sort((a, b) => a - b)
  const slices = [...sessions]
    .sort((a, b) => +a.startTime - +b.startTime)
    .flatMap((session) => {
      const start = +session.startTime
      const end = +session.endTime
      const points = [start, ...boundaries.filter((point) => point > start && point < end), end]
      return points
        .slice(0, -1)
        .map((point, index) => {
          const sliceEnd = points[index + 1]
          const sourceBlocks = session.sourceBlocks.flatMap((block) => {
            const clippedStart = Math.max(point, +block.startTime)
            const clippedEnd = Math.min(sliceEnd, +block.endTime)
            if (clippedEnd <= clippedStart) return []
            return [
              {
                ...block,
                startTime: new Date(clippedStart),
                endTime: new Date(clippedEnd),
                durationMs:
                  (block.durationMs * (clippedEnd - clippedStart)) /
                  Math.max(1, +block.endTime - +block.startTime)
              }
            ]
          })
          const slice =
            points.length === 2
              ? session
              : {
                  ...session,
                  startTime: new Date(
                    sourceBlocks.length
                      ? Math.min(...sourceBlocks.map((block) => +block.startTime))
                      : point
                  ),
                  endTime: new Date(
                    sourceBlocks.length
                      ? Math.max(...sourceBlocks.map((block) => +block.endTime))
                      : sliceEnd
                  ),
                  activeDurationMs: sessionContributionWithin(session, point, sliceEnd),
                  sourceBlocks
                }
          const goal = candidates.find(
            (candidate) => +candidate.startTime <= point && +candidate.endTime >= sliceEnd
          )
          return { session: slice, goal, key: '' }
        })
        .filter((item) => item.session.activeDurationMs > 0)
    })

  // A sustained distracted/uncertain stretch gets its own block, even during
  // a timer. Brief checks stay visible inside the surrounding goal instead.
  for (let index = 0; index < slices.length; ) {
    let end = index + 1
    const first = slices[index]
    while (
      end < slices.length &&
      slices[end].goal?.phaseId === first.goal?.phaseId &&
      slices[end].session.isProductive === first.session.isProductive &&
      +slices[end].session.startTime - +slices[end - 1].session.endTime < TIMELINE_GAP_MS
    )
      end += 1
    const duration = slices
      .slice(index, end)
      .reduce((total, item) => total + item.session.activeDurationMs, 0)
    for (let cursor = index; cursor < end; cursor += 1) {
      const item = slices[cursor]
      const session = item.session
      item.key =
        item.goal && (session.isProductive === true || duration < BRIEF_ACTIVITY_MS)
          ? `goal:${item.goal.phaseId}`
          : session.activeDurationMs < BRIEF_ACTIVITY_MS && !item.goal
            ? 'brief'
            : `activity:${session.displayKey}:${session.label.trim().toLowerCase()}:${String(session.isProductive)}`
    }
    index = end
  }

  const labels = new Map(
    slices.map(({ key, session }) => [key, { label: session.label, summary: session.summary }])
  )
  // Seconds between a timer ending and the next activity are transitions,
  // not a separate chapter. Keep their source sessions in the neighboring block.
  for (let index = 0; index < slices.length; ) {
    if (slices[index].key !== 'brief') {
      index += 1
      continue
    }
    let end = index + 1
    while (
      end < slices.length &&
      slices[end].key === 'brief' &&
      +slices[end].session.startTime - +slices[end - 1].session.endTime < TIMELINE_GAP_MS
    )
      end += 1
    const duration = slices
      .slice(index, end)
      .reduce((sum, item) => sum + item.session.activeDurationMs, 0)
    const previous = slices[index - 1]
    const next = slices[end]
    const neighbor =
      previous && +slices[index].session.startTime - +previous.session.endTime < TIMELINE_GAP_MS
        ? previous
        : next && +next.session.startTime - +slices[end - 1].session.endTime < TIMELINE_GAP_MS
          ? next
          : undefined
    if (duration < BRIEF_ACTIVITY_MS && neighbor) {
      for (let cursor = index; cursor < end; cursor += 1) slices[cursor].key = neighbor.key
    }
    index = end
  }

  // A quick excursion followed by a return belongs to the same activity.
  for (let index = 1; index < slices.length - 1; index += 1) {
    const previous = slices[index - 1]
    let end = index
    let duration = 0
    while (
      end < slices.length &&
      duration < BRIEF_ACTIVITY_MS &&
      slices[end].key !== previous.key &&
      slices[end].goal?.phaseId === previous.goal?.phaseId &&
      +slices[end].session.startTime - +slices[end - 1].session.endTime < TIMELINE_GAP_MS
    ) {
      duration += slices[end].session.activeDurationMs
      end += 1
    }
    if (
      end < slices.length &&
      slices[end].key === previous.key &&
      duration < BRIEF_ACTIVITY_MS &&
      +slices[end].session.startTime - +slices[end - 1].session.endTime < TIMELINE_GAP_MS
    ) {
      for (let cursor = index; cursor < end; cursor += 1) slices[cursor].key = previous.key
    }
  }

  const chapters: TimelineChapter[] = []
  let previousKey: string | undefined
  for (const { session, key } of slices) {
    const current = chapters[chapters.length - 1]
    const gap = current ? +session.startTime - +current.endTime : 0
    if (!current || gap >= TIMELINE_GAP_MS || key !== previousKey) {
      chapters.push({
        id: `chapter:${+session.startTime}:${chapters.length}`,
        startTime: session.startTime,
        endTime: session.endTime,
        sessions: [],
        focusedMs: 0,
        distractedMs: 0,
        uncertainMs: 0,
        label: key === 'brief' ? 'Short activities' : labels.get(key)?.label || session.label,
        summary: key === 'brief' ? undefined : labels.get(key)?.summary,
        boundaryReason: !current
          ? 'Start of tracked activity'
          : gap >= TIMELINE_GAP_MS
            ? 'Resumed after a gap'
            : key.startsWith('goal:')
              ? previousKey?.startsWith('goal:')
                ? 'Focus session or goal changed'
                : 'Focus session activity'
              : session.isProductive === false
                ? 'Distracting activity'
                : session.isProductive === undefined
                  ? 'Uncertain activity'
                  : 'Activity changed'
      })
    }
    const target = chapters[chapters.length - 1]
    target.sessions.push(session)
    target.endTime = new Date(Math.max(+target.endTime, +session.endTime))
    if (session.isProductive === true) target.focusedMs += session.activeDurationMs
    else if (session.isProductive === false) target.distractedMs += session.activeDurationMs
    else target.uncertainMs += session.activeDurationMs
    previousKey = key
  }
  const annotated = attachFocusGoalsToTimelineChapters(chapters, runs, nowMs)
  const grouped: TimelineChapter[] = []
  for (const chapter of annotated) {
    const previous = grouped[grouped.length - 1]
    const goal = chapter.focusGoal
    const previousGoal = previous?.focusGoal
    if (
      goal?.kind === 'custom' &&
      previousGoal?.kind === 'custom' &&
      goal.goal.trim().toLowerCase() === previousGoal.goal.trim().toLowerCase() &&
      +chapter.startTime - +previous.endTime < TIMELINE_GAP_MS
    ) {
      previous.endTime = new Date(Math.max(+previous.endTime, +chapter.endTime))
      previous.sessions.push(...chapter.sessions)
      previous.focusedMs += chapter.focusedMs
      previous.distractedMs += chapter.distractedMs
      previous.uncertainMs += chapter.uncertainMs
      previous.focusGoal = {
        ...previousGoal,
        endTime: goal.endTime,
        runIds: [
          ...new Set([
            ...(previousGoal.runIds || [previousGoal.runId]),
            ...(goal.runIds || [goal.runId])
          ])
        ],
        focusedMs: previous.focusedMs,
        distractedMs: previous.distractedMs,
        uncertainMs: previous.uncertainMs,
        observedMs: previous.focusedMs + previous.distractedMs + previous.uncertainMs,
        ...adherenceFor(previous.focusedMs, previous.distractedMs, previous.uncertainMs)
      }
    } else grouped.push({ ...chapter, sessions: [...chapter.sessions] })
  }
  return grouped
}

type FocusGoalCandidate = Omit<TimelineFocusGoal, 'isLead'>

const intervalOverlapMs = (
  startMs: number,
  endMs: number,
  rangeStartMs: number,
  rangeEndMs: number
) => Math.max(0, Math.min(endMs, rangeEndMs) - Math.max(startMs, rangeStartMs))

/**
 * A processed activity block can be coalesced, so allocate an overlapping
 * wall-clock slice proportionally rather than double-counting a whole block
 * at the boundary of a focus phase.
 */
const sessionContributionWithin = (
  session: ActivitySessionBlock,
  startMs: number,
  endMs: number
) => {
  const sources = session.sourceBlocks
  const sourceTotal = sources.reduce((total, block) => total + block.durationMs, 0)
  if (sources.length && Math.abs(sourceTotal - session.activeDurationMs) < 1) {
    return sources.reduce((total, block) => {
      const span = Math.max(1, +block.endTime - +block.startTime)
      const overlap = intervalOverlapMs(+block.startTime, +block.endTime, startMs, endMs)
      return total + Math.min(block.durationMs, (block.durationMs * overlap) / span)
    }, 0)
  }
  const sessionStart = session.startTime.getTime()
  const sessionEnd = session.endTime.getTime()
  const overlap = intervalOverlapMs(sessionStart, sessionEnd, startMs, endMs)
  const span = Math.max(1, sessionEnd - sessionStart)
  return Math.min(session.activeDurationMs, session.activeDurationMs * (overlap / span))
}

const chapterContributionWithin = (chapter: TimelineChapter, startMs: number, endMs: number) =>
  chapter.sessions.reduce(
    (totals, session) => {
      const contribution = sessionContributionWithin(session, startMs, endMs)
      totals.overlapMs += contribution
      if (session.isProductive === true) totals.focusedMs += contribution
      else if (session.isProductive === false) totals.distractedMs += contribution
      else totals.uncertainMs += contribution
      return totals
    },
    { overlapMs: 0, focusedMs: 0, distractedMs: 0, uncertainMs: 0 }
  )

const adherenceFor = (
  focusedMs: number,
  distractedMs: number,
  uncertainMs: number
): Pick<TimelineFocusGoal, 'focusRatio' | 'adherence' | 'adherenceLabel'> => {
  const observedMs = focusedMs + distractedMs + uncertainMs
  const decidedMs = focusedMs + distractedMs
  if (observedMs < 60_000 || decidedMs < 30_000) {
    return {
      focusRatio: null,
      adherence: 'not_enough_activity',
      adherenceLabel: 'No classified activity yet'
    }
  }
  if (uncertainMs > decidedMs) {
    return {
      focusRatio: null,
      adherence: 'mostly_uncertain',
      adherenceLabel: 'Mostly awaiting classification'
    }
  }
  const focusRatio = focusedMs / Math.max(1, decidedMs)
  if (focusRatio >= 0.85) return { focusRatio, adherence: 'on_track', adherenceLabel: 'On track' }
  if (focusRatio >= 0.65)
    return { focusRatio, adherence: 'mostly_on_track', adherenceLabel: 'Mostly on track' }
  return { focusRatio, adherence: 'interrupted', adherenceLabel: 'Focus was interrupted' }
}

const focusGoalCandidates = (runs: FocusTimelineRun[], nowMs: number): FocusGoalCandidate[] =>
  runs.flatMap(({ run, endedAtMs }) =>
    run.phases.flatMap((phase, phaseIndex) => {
      const startMs = phase.startedAtMs
      if (phase.kind !== 'work' || !phase.goal?.trim() || !startMs) return []
      const nextStartedAtMs = run.phases
        .slice(phaseIndex + 1)
        .find((next) => typeof next.startedAtMs === 'number')?.startedAtMs
      const fallbackEndMs =
        run.state === 'active'
          ? nowMs
          : run.completedAtMs || endedAtMs || startMs + phase.activeElapsedMs
      const phaseEndMs = phase.completedAtMs || nextStartedAtMs || fallbackEndMs
      if (phaseEndMs <= startMs) return []

      // Newer phases carry a boundary for each goal change. Older persisted
      // phases intentionally fall back to their one immutable snapshot.
      const history =
        phase.goalHistory
          ?.filter(
            (segment) =>
              segment.goal?.trim() &&
              Number.isFinite(segment.startedAtMs) &&
              segment.startedAtMs >= startMs &&
              segment.startedAtMs < phaseEndMs
          )
          .sort((left, right) => left.startedAtMs - right.startedAtMs) || []
      const segments = history.length
        ? history
        : [
            {
              goal: phase.goal.trim(),
              todayPlanTask: phase.todayPlanTask || null,
              startedAtMs: startMs
            }
          ]

      return segments.flatMap((segment, segmentIndex) => {
        const segmentStartMs = Math.max(startMs, segment.startedAtMs)
        const segmentEndMs = Math.min(
          phaseEndMs,
          segments[segmentIndex + 1]?.startedAtMs || phaseEndMs
        )
        if (segmentEndMs <= segmentStartMs) return []
        return [
          {
            runId: run.id,
            // Treat each goal boundary as its own lead annotation. A phase can
            // therefore show the task that was actually active for a chapter.
            phaseId: `${run.id}:${phase.id}:${segmentIndex}`,
            phaseIndex,
            kind: run.kind,
            goal: segment.goal.trim(),
            startTime: new Date(segmentStartMs),
            endTime: new Date(segmentEndMs),
            focusedMs: 0,
            distractedMs: 0,
            uncertainMs: 0,
            observedMs: 0,
            focusRatio: null,
            adherence: 'not_enough_activity' as const,
            adherenceLabel: 'No classified activity yet'
          }
        ]
      })
    })
  )

/**
 * Annotates explicit work phases. Adherence always describes this block's
 * classified activity, so its score and durations agree with the visible rail.
 */
export const attachFocusGoalsToTimelineChapters = (
  chapters: TimelineChapter[],
  runs: FocusTimelineRun[] | undefined,
  nowMs = Date.now()
): TimelineChapter[] => {
  if (!runs?.length || !chapters.length) return chapters
  const candidates = focusGoalCandidates(runs, nowMs)
  if (!candidates.length) return chapters

  const chapterCandidates = chapters.map((chapter) => {
    const matching = candidates
      .map((candidate) => ({
        candidate,
        ...chapterContributionWithin(
          chapter,
          candidate.startTime.getTime(),
          candidate.endTime.getTime()
        )
      }))
      .filter((match) => match.overlapMs > 0)
      .sort((left, right) => right.overlapMs - left.overlapMs)
    const strongest = matching[0]
    // A running focus session supplies useful context for its aggregate score,
    // but it is not a label for every moment inside the phase. Only attach the
    // goal to a chapter whose *overlapping classified activity* is genuinely
    // focus-led. A distracted or uncertain detour stays honest and standalone.
    if (
      !strongest ||
      strongest.overlapMs < (chapter.focusedMs + chapter.distractedMs + chapter.uncertainMs) / 2 ||
      strongest.focusedMs <= 0 ||
      strongest.focusedMs <= strongest.distractedMs ||
      strongest.focusedMs < strongest.uncertainMs
    ) {
      return null
    }
    return strongest.candidate
  })

  const firstChapterForPhase = new Map<string, number>()
  chapterCandidates.forEach((candidate, index) => {
    if (candidate && !firstChapterForPhase.has(candidate.phaseId)) {
      firstChapterForPhase.set(candidate.phaseId, index)
    }
  })

  return chapters.map((chapter, index) => {
    const focusGoal = chapterCandidates[index]
    if (!focusGoal) return chapter
    return {
      ...chapter,
      focusGoal: {
        ...focusGoal,
        focusedMs: chapter.focusedMs,
        distractedMs: chapter.distractedMs,
        uncertainMs: chapter.uncertainMs,
        observedMs: chapter.focusedMs + chapter.distractedMs + chapter.uncertainMs,
        ...adherenceFor(chapter.focusedMs, chapter.distractedMs, chapter.uncertainMs),
        isLead: firstChapterForPhase.get(focusGoal.phaseId) === index
      }
    }
  })
}

/**
 * App totals support a concise block summary; retained sessions provide the
 * chronological activity detail when the block is expanded.
 */
export const summarizeTimelineChapterApps = (
  chapter: TimelineChapter
): TimelineChapterAppUsage[] => {
  const apps = new Map<string, TimelineChapterAppUsage>()
  for (const session of chapter.sessions) {
    const appName = session.ownerName || 'Unknown app'
    const existing = apps.get(appName)
    if (existing) {
      existing.durationMs += session.activeDurationMs
      existing.sessionCount += 1
    } else {
      apps.set(appName, { appName, durationMs: session.activeDurationMs, sessionCount: 1 })
    }
  }
  return [...apps.values()].sort((left, right) => right.durationMs - left.durationMs)
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

const removeHistoricalFirefoxCaptureDuplicates = (
  blocks: ProcessedEventBlock[]
): ProcessedEventBlock[] =>
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
  label: displayActivityLabel(block),
  summary: displayActivitySummary(block),
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

  const currentPrimaryDuration = Math.max(
    ...session.sourceBlocks.slice(0, -1).map((item) => item.durationMs)
  )
  const nextIsManual = statusIsManual(block.classificationStatus)
  const currentIsManual = statusIsManual(session.classificationStatus)
  if (
    (nextIsManual && !currentIsManual) ||
    (!currentIsManual && block.durationMs > currentPrimaryDuration)
  ) {
    session.label = displayActivityLabel(block)
    session.summary = displayActivitySummary(block)
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
        candidate.ownerName === session.ownerName &&
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

export const buildActivitySessions = (
  blocks: ProcessedEventBlock[],
  { foldBrief = true }: { foldBrief?: boolean } = {}
): ActivitySessionBlock[] => {
  const sorted = removeHistoricalFirefoxCaptureDuplicates(blocks)
    .filter((block) => block.durationMs > 0)
    .sort((left, right) => left.startTime.getTime() - right.startTime.getTime())
  const sessions: ActivitySessionBlock[] = []

  for (const block of sorted) {
    const openSession = sessions[sessions.length - 1]
    if (openSession && canMerge(openSession, block)) mergeIntoSession(openSession, block)
    else sessions.push(makeSession(block))
  }
  return foldBrief ? foldBriefProductiveSessions(sessions) : sessions
}

export const buildDayActivitySummaries = (
  sessions: ActivitySessionBlock[]
): DayActivitySummary[] => {
  const summaries = new Map<string, DayActivitySummary>()
  for (const session of sessions) {
    // The day inspector is a compact source list, rather than a second browser
    // history.  A source is therefore an application, irrespective of its
    // page title, category, or number of visits.  The underlying sessions are
    // kept intact for the selected-source inspector and recategorisation.
    const ownerName = session.ownerName?.trim() || 'Unknown app'
    const displayKey = `source:${normalize(ownerName) || 'unknown'}`
    const existing = summaries.get(displayKey)
    if (existing) {
      existing.totalDurationMs += session.activeDurationMs
      existing.sessionIds.push(session.id)
      existing.sessions.push(session)
      existing.startTime = new Date(
        Math.min(existing.startTime.getTime(), session.startTime.getTime())
      )
      existing.endTime = new Date(Math.max(existing.endTime.getTime(), session.endTime.getTime()))
      if (session.isProductive === true) existing.focusedMs += session.activeDurationMs
      else if (session.isProductive === false) existing.distractedMs += session.activeDurationMs
      else existing.uncertainMs += session.activeDurationMs
    } else {
      summaries.set(displayKey, {
        displayKey,
        label: ownerName,
        ownerName,
        totalDurationMs: session.activeDurationMs,
        focusedMs: session.isProductive === true ? session.activeDurationMs : 0,
        distractedMs: session.isProductive === false ? session.activeDurationMs : 0,
        uncertainMs: session.isProductive === undefined ? session.activeDurationMs : 0,
        startTime: session.startTime,
        endTime: session.endTime,
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
