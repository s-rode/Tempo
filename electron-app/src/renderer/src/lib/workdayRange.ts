export interface WorkdayRange {
  startDateMs: number
  endDateMs: number
}

const workdayStartFor = (nowMs: number): Date => {
  const now = new Date(nowMs)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 0, 0, 0)
  if (now < start) start.setDate(start.getDate() - 1)
  return start
}

/**
 * Returns Tempo's local 06:00-to-06:00 workday window. Calendar arithmetic is
 * intentional here: a workday crossing a daylight-saving change is not always
 * 24 hours long.
 */
export function getWorkdayRange(nowMs = Date.now(), resetAtMs: number | null | undefined = null): WorkdayRange {
  const start = workdayStartFor(nowMs)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return {
    startDateMs: Math.max(start.getTime(), resetAtMs || 0),
    endDateMs: end.getTime()
  }
}

export const sameWorkdayRange = (left: WorkdayRange | null, right: WorkdayRange): boolean =>
  Boolean(left && left.startDateMs === right.startDateMs && left.endDateMs === right.endDateMs)
