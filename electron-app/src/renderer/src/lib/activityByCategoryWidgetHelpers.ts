export const formatDuration = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : minutes
      ? `${minutes}m`
      : `${seconds}s`
}

export const extractWebsiteInfo = (
  url: string,
  title: string
): { domain: string; name: string } => {
  try {
    const urlObj = new URL(url)
    const domain = urlObj.hostname.replace(/^www\./, '')

    let cleanTitle = title
      .replace(/ - Google Chrome$/i, '')
      .replace(/ - Chrome$/i, '')
      .replace(/ - Safari$/i, '')
      .replace(/ - Microsoft\ Edge$/i, '')
      .replace(/ - Firefox$/i, '')
      .replace(/^\([0-9]+\) /, '') // Remove notification counts like "(2) Gmail"
      .trim()

    if (!cleanTitle || cleanTitle.length < 3 || cleanTitle.toLowerCase() === domain.toLowerCase()) {
      cleanTitle = domain // Fallback to domain if title is not descriptive or same as domain
    }
    return { domain, name: cleanTitle }
  } catch {
    return { domain: 'unknown', name: title || 'Unknown Website' }
  }
}
