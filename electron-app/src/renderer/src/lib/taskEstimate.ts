/** Parse only explicit time units at the end; bare numbers belong to the title. */
export function parseTaskEstimate(input: string): {
  title: string
  estimatedMinutes: number | null
  recognized: boolean
} {
  const value = input.trim()
  const match = value.match(/(?:^|\s)(?:(\d{1,2})\s*h(?:ours?|rs?)?\s*)?(?:(\d{1,3})\s*(?:m(?:in(?:utes?)?)?))?\s*$/i)
  if (!match || (!match[1] && !match[2]))
    return { title: value, estimatedMinutes: null, recognized: false }
  const minutes = Number(match[1] || 0) * 60 + Number(match[2] || 0)
  const title = value.slice(0, match.index).trim().replace(/^\*\*(.*?)\*\*$/, '$1').trim()
  if (!title || minutes < 1 || minutes > 720)
    return { title: value, estimatedMinutes: null, recognized: false }
  return { title, estimatedMinutes: minutes, recognized: true }
}

export const displayMinutes = (minutes: number) =>
  minutes >= 60
    ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`
    : `${minutes}m`

export const pomodoroSummary = (minutes: number) => {
  const blocks = Math.ceil(minutes / 30)
  const breaks = Math.max(0, blocks - 1)
  return `${blocks} work block${blocks === 1 ? '' : 's'} · ${breaks} break${breaks === 1 ? '' : 's'} · ${displayMinutes(breaks * 5)} break time`
}
