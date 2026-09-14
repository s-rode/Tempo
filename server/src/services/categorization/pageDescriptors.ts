import crypto from 'crypto';
import type { ActiveWindowDetails } from '../../../../shared/types';
import { PageActivityDescriptorModel } from '../../models/pageActivityDescriptor';
import type { PageActivityDescriptorData } from './pageDescriptorTypes';

export const PAGE_DESCRIPTOR_POLICY_VERSION = 'page-descriptor-v1';
export const CLASSIFIER_POLICY_VERSION = 'semantic-grounded-v1';

export const sanitizeDerivedDescriptorText = (text: string): string =>
  text
    .replace(/https?:\/\/\S+/gi, '[page]')
    .replace(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi, '[page]')
    .replace(/\s+/g, ' ')
    .trim();

type DescriptorInput = Pick<
  ActiveWindowDetails,
  'ownerName' | 'title' | 'content' | 'contentSource' | 'siteHost'
>;

export function fallbackPageDescriptor(
  activity: DescriptorInput
): Omit<PageActivityDescriptorData, 'revision'> {
  const label = (activity.title || activity.ownerName || 'Unreadable activity')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return {
    pageKind: 'unknown',
    actionLabel: label || 'Unreadable activity',
    topicCues: [],
    evidenceQuality: label ? 'weak' : 'weak',
    source:
      activity.contentSource === 'dom' || activity.contentSource === 'ocr'
        ? activity.contentSource
        : 'title',
  };
}

export function descriptorRevision(
  descriptor: Omit<PageActivityDescriptorData, 'revision'>
): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ version: PAGE_DESCRIPTOR_POLICY_VERSION, ...descriptor }))
    .digest('hex');
}

export async function readCachedPageDescriptor(
  userId: string,
  activityKey: string
): Promise<PageActivityDescriptorData | null> {
  const value = await PageActivityDescriptorModel.findOne({
    userId,
    activityKey,
    policyVersion: PAGE_DESCRIPTOR_POLICY_VERSION,
  }).lean();
  if (!value) return null;
  return {
    pageKind: value.pageKind as PageActivityDescriptorData['pageKind'],
    actionLabel: value.actionLabel,
    topicCues: (value.topicCues || []).slice(0, 6),
    evidenceQuality: value.evidenceQuality,
    source: value.source,
    revision: value.revision,
  };
}

export async function persistPageDescriptor(
  userId: string,
  activityKey: string,
  value: Omit<PageActivityDescriptorData, 'revision'>
): Promise<PageActivityDescriptorData> {
  const normalized = {
    ...value,
    actionLabel: sanitizeDerivedDescriptorText(value.actionLabel).slice(0, 60),
    topicCues: value.topicCues
      .map((cue) => sanitizeDerivedDescriptorText(cue).slice(0, 32))
      .filter(Boolean)
      .slice(0, 6),
  };
  const revision = descriptorRevision(normalized);
  await PageActivityDescriptorModel.updateOne(
    { userId, activityKey, policyVersion: PAGE_DESCRIPTOR_POLICY_VERSION },
    {
      $set: { ...normalized, revision },
      $setOnInsert: { userId, activityKey, policyVersion: PAGE_DESCRIPTOR_POLICY_VERSION },
    },
    { upsert: true }
  );
  return { ...normalized, revision };
}
