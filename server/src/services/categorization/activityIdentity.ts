import { createHash, createHmac } from 'crypto';
import { ActiveWindowDetails } from '../../../../shared/types';

export const normalizeActivityText = (value: string | null | undefined): string =>
  (value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();

export const fingerprintCapturedContent = (content: string | null | undefined): string | null => {
  const normalized = normalizeActivityText(content);
  if (!normalized) return null;
  return createHash('sha256').update(normalized).digest('hex');
};

const fingerprint = (value: string): string => createHash('sha256').update(value).digest('hex');

const correctionKey = (value: string): string =>
  createHmac('sha256', process.env.AUTH_SECRET || 'local-development-secret')
    .update(`tempo-page-correction-v1\u0000${value}`)
    .digest('hex');

/**
 * Normalizes a page into the user-meaningful tool/page boundary. Query strings
 * and fragments are deliberately excluded: they often hold tracking state or
 * transient calculator state and must not make a corrected page look new.
 */
export const canonicalPageIdentity = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `${parsed.protocol}//${parsed.host.toLocaleLowerCase()}${pathname}`;
    }
    return `${parsed.protocol}${pathname}`;
  } catch (_error) {
    return null;
  }
};

/**
 * A page correction identity is intentionally separate from the exact
 * activity key. Firefox supplies its key from the native bridge because its
 * URL never crosses into the renderer/server; other browsers derive one from
 * the already-transient URL in the local server.
 */
export const pageCorrectionKeyFor = (
  activity: Pick<ActiveWindowDetails, 'url' | 'type' | 'browser' | 'pageCorrectionKey'>
): string | null => {
  if (activity.browser === 'firefox') {
    return /^[a-f0-9]{64}$/.test(activity.pageCorrectionKey || '')
      ? activity.pageCorrectionKey || null
      : null;
  }
  if (activity.type !== 'browser') return null;
  const identity = canonicalPageIdentity(activity.url);
  return identity ? correctionKey(identity) : null;
};

export const activityKeyFor = (
  activity: Pick<ActiveWindowDetails, 'ownerName' | 'title' | 'url' | 'type' | 'browser'>,
  contentFingerprint: string | null
): string => {
  if (activity.browser === 'firefox') {
    return `firefox:${fingerprint(`${normalizeActivityText(activity.title)}:${contentFingerprint || ''}`)}`;
  }

  if (activity.type === 'browser' && activity.url) {
    try {
      const url = new URL(activity.url);
      url.hash = '';
      return `browser:${fingerprint(url.toString())}`;
    } catch (_error) {
      // Fall through to the stable title-based key.
    }
  }

  return `app:${fingerprint(`${normalizeActivityText(activity.ownerName)}:${normalizeActivityText(activity.title)}`)}`;
};
