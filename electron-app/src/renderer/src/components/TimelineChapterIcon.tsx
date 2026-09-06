import { useEffect, useState } from 'react'
import type { TimelineChapter } from '../lib/activitySessions'
import AppIcon from './AppIcon'

const iconDataUrls = new Map<string, string | null>()

const normalize = (value: string | undefined | null) =>
  (value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()

/** A chapter title is generated when it is not a captured title or app name. */
export const isGeneratedChapterLabel = (chapter: TimelineChapter): boolean => {
  const label = normalize(chapter.label)
  if (!label) return false
  return !chapter.sessions.some((session) =>
    [session.ownerName, session.title].filter(Boolean).some((source) => normalize(source) === label)
  )
}

export const chapterEmoji = (label: string): string => {
  const value = normalize(label)
  if (/(study|exam|learn|lecture|flashcard|course|notes?)/.test(value)) return '📚'
  if (/(design|icon|draw|visual|figma)/.test(value)) return '🎨'
  if (/(code|build|implement|debug|develop)/.test(value)) return '🛠️'
  if (/(research|search|read|reference)/.test(value)) return '🔎'
  if (/(write|draft|report|essay)/.test(value)) return '✍️'
  if (/(meeting|call|chat|message|mail)/.test(value)) return '💬'
  if (/(break|music|video|browse|social)/.test(value)) return '☕️'
  return '✦'
}

/**
 * A local macOS application icon.  This is shared by the timeline and the
 * day inspector so source rows never fall back to decorative letter tiles
 * when the system can identify the application.
 */
export function NativeAppIcon({ appName, size }: { appName: string; size: number }) {
  const [src, setSrc] = useState<string | null | undefined>(() => iconDataUrls.get(appName))

  useEffect(() => {
    let disposed = false
    const cached = iconDataUrls.get(appName)
    if (cached !== undefined) {
      setSrc(cached)
      return () => {
        disposed = true
      }
    }
    window.api
      ?.getAppIconDataUrl(appName)
      .then((next) => {
        iconDataUrls.set(appName, next)
        if (!disposed) setSrc(next)
      })
      .catch(() => {
        iconDataUrls.set(appName, null)
        if (!disposed) setSrc(null)
      })
    return () => {
      disposed = true
    }
  }, [appName])

  if (src) {
    return (
      <img
        src={src}
        alt={`${appName} icon`}
        width={size}
        height={size}
        className="shrink-0 rounded-[5px] shadow-sm"
      />
    )
  }
  return <AppIcon appName={appName} size={size} className="shrink-0" />
}

/** Uses a local macOS app icon for source-named chapters, otherwise an emoji for generated/mixed chapters. */
export function TimelineChapterIcon({
  chapter,
  size = 18
}: {
  chapter: TimelineChapter
  size?: number
}) {
  const owners = [...new Set(chapter.sessions.map((session) => session.ownerName).filter(Boolean))]
  const isSingleAppDistraction =
    owners.length === 1 &&
    chapter.distractedMs > 0 &&
    chapter.focusedMs === 0 &&
    chapter.uncertainMs === 0
  const shouldUseEmoji =
    owners.length !== 1 || (isGeneratedChapterLabel(chapter) && !isSingleAppDistraction)

  if (shouldUseEmoji) {
    return (
      <span
        aria-label={`${chapter.label} chapter`}
        className="flex shrink-0 items-center justify-center rounded-[5px] bg-background/70 text-[15px] leading-none shadow-sm ring-1 ring-black/5 dark:ring-white/10"
        style={{ width: size, height: size }}
      >
        {chapterEmoji(chapter.label)}
      </span>
    )
  }

  return <NativeAppIcon appName={owners[0]} size={size} />
}
