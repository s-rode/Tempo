export const PAGE_KINDS = [
  'problem_solving',
  'learning',
  'reference',
  'note_taking',
  'coding',
  'writing',
  'communication',
  'administration',
  'social',
  'entertainment',
  'shopping',
  'general_browsing',
  'other',
  'unknown',
] as const;

export type PageKind = (typeof PAGE_KINDS)[number];
export type EvidenceQuality = 'strong' | 'partial' | 'weak';

export interface PageActivityDescriptorData {
  pageKind: PageKind;
  actionLabel: string;
  topicCues: string[];
  evidenceQuality: EvidenceQuality;
  source: 'dom' | 'ocr' | 'title';
  revision: string;
}

export const isPageKind = (value: unknown): value is PageKind =>
  typeof value === 'string' && (PAGE_KINDS as readonly string[]).includes(value);
