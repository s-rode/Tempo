import { createHash } from 'crypto';
import { ActiveWindowDetails } from '../../../../shared/types';

export const normalizeActivityText = (value: string | null | undefined): string =>
  (value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();

export const fingerprintCapturedContent = (content: string | null | undefined): string | null => {
  const normalized = normalizeActivityText(content);
  if (!normalized) return null;
  return createHash('sha256').update(normalized).digest('hex');
};

const fingerprint = (value: string): string => createHash('sha256').update(value).digest('hex');

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
