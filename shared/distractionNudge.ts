export const DISTRACTION_NUDGE_VERSION = 'custom-v1';

export interface DistractionNudge {
  title: string;
  body: string;
}

/** Reject old status-report templates rather than presenting them as custom copy. */
export function usableDistractionNudge(
  title: string | null | undefined,
  body: string | null | undefined
): DistractionNudge | null {
  const cleanTitle = title?.replace(/\s+/g, ' ').trim() || '';
  const cleanBody = body?.replace(/\s+/g, ' ').trim() || '';
  const text = `${cleanTitle} ${cleanBody}`.toLocaleLowerCase();
  if (!cleanTitle || !cleanBody || text.includes('currently marked as distracting') ||
      text.startsWith('return to:') || text.includes('distraction: distracting')) return null;
  return { title: cleanTitle, body: cleanBody };
}
