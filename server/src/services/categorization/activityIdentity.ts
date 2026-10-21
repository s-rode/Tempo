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

const learningKey = (scope: 'app' | 'site', value: string): string =>
  createHmac('sha256', process.env.AUTH_SECRET || 'local-development-secret')
    .update(`tempo-learning-${scope}-v1\u0000${value}`)
    .digest('hex');

export interface LearningToolIdentity {
  /** Opaque per-install key. Browser hostnames never leave transient memory. */
  key: string;
  kind: 'app' | 'site';
  /** A human-readable application label; never a browser hostname or URL. */
  label: string;
}

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

/**
 * Learning is intentionally narrower than "Firefox is productive": browser
 * examples are scoped to an HMAC of the hostname, while native examples are
 * scoped to their application. The label is only for the local Settings UI.
 */
export const learningToolIdentityFor = (
  activity: Pick<
    ActiveWindowDetails,
    'ownerName' | 'type' | 'browser' | 'siteHost' | 'siteIdentity' | 'url'
  >
): LearningToolIdentity | null => {
  if (activity.type === 'browser') {
    let host = normalizeActivityText(activity.siteHost);
    if (!host && activity.url) {
      try {
        host = new URL(activity.url).hostname.toLocaleLowerCase();
      } catch (_error) {
        host = '';
      }
    }
    if (!host && /^[a-f0-9]{64}$/.test(activity.siteIdentity || ''))
      return {
        key: activity.siteIdentity!,
        kind: 'site',
        label: `${activity.ownerName || 'Browser'} website`,
      };
    if (!host) return null;
    return {
      key: learningKey('site', host),
      kind: 'site',
      label: `${activity.ownerName || 'Browser'} website`,
    };
  }
  const application = normalizeActivityText(activity.ownerName);
  if (!application) return null;
  return {
    key: learningKey('app', application),
    kind: 'app',
    label: activity.ownerName.trim().slice(0, 80),
  };
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
