import { beforeEach, describe, expect, jest, mock, test } from 'bun:test';
import { ActiveWindowDetails } from '../../../../shared/types';
import { activityKeyFor, fingerprintCapturedContent } from './activityIdentity';

const events = { findOne: jest.fn() };
mock.module('../../models/activeWindowEvent', () => ({ ActiveWindowEventModel: events }));
const { checkActivityHistory, findRecentPageDecision, RECENT_PAGE_DECISION_MAX_AGE_MS } =
  await import('./history');

const userId = 'local-user';
const classificationContextFingerprint = 'classification-context';
const resolved = {
  categoryId: 'work',
  decisionConfidence: 'high',
  evidenceQuality: 'strong',
};
const expectedHistoryQuery = (activityKey: string) => ({
  userId,
  activityKey,
  classificationContextFingerprint,
  $and: [
    { $or: [{ decisionExpiresAtMs: null }, { decisionExpiresAtMs: { $gt: expect.any(Number) } }] },
  ],
  classificationStatus: { $in: ['deterministic_direct', 'ollama', 'policy_override'] },
  $or: [
    { classificationStatus: 'deterministic_direct' },
    {
      classificationStatus: 'policy_override',
      decisionConfidence: { $in: ['high', 'medium'] },
      learningExampleId: { $ne: null },
    },
    {
      decisionConfidence: { $in: ['high', 'medium'] },
      evidenceQuality: { $in: ['strong', 'partial'] },
    },
  ],
});
const mockHistoryResult = () =>
  events.findOne.mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(resolved),
  });

describe('checkActivityHistory', () => {
  beforeEach(() => jest.clearAllMocks());

  test('uses the canonical URL activity key for browser history', async () => {
    const active = {
      ownerName: 'Chrome',
      type: 'browser' as const,
      browser: 'chrome' as const,
      title: 'GP',
      url: 'https://example.test/gp#section',
      content: null,
    };
    mockHistoryResult();
    await expect(
      checkActivityHistory(userId, active, classificationContextFingerprint)
    ).resolves.toMatchObject(resolved);
    expect(events.findOne).toHaveBeenCalledWith(expectedHistoryQuery(activityKeyFor(active, null)));
  });

  test('uses title plus OCR fingerprint for Firefox history', async () => {
    const active = {
      ownerName: 'Firefox',
      type: 'browser' as const,
      browser: 'firefox' as const,
      title: 'Study notes',
      url: null,
      content: 'Gaussian process regression',
    };
    mockHistoryResult();
    await checkActivityHistory(userId, active, classificationContextFingerprint);
    expect(events.findOne).toHaveBeenCalledWith(
      expectedHistoryQuery(activityKeyFor(active, fingerprintCapturedContent(active.content)))
    );
  });

  test('does not reuse a Firefox event when OCR text is absent', async () => {
    const active = {
      ownerName: 'Firefox',
      type: 'browser' as const,
      browser: 'firefox' as const,
      title: 'Study notes',
      url: null,
      content: null,
    };
    await expect(
      checkActivityHistory(userId, active, classificationContextFingerprint)
    ).resolves.toBeNull();
    expect(events.findOne).not.toHaveBeenCalled();
  });

  test('never reuses history by application name alone', async () => {
    const mail = {
      ownerName: 'Mail',
      type: 'window' as const,
      title: 'Course administration',
      url: null,
      content: null,
    };
    mockHistoryResult();
    await checkActivityHistory(userId, mail, classificationContextFingerprint);
    expect(events.findOne).toHaveBeenCalledWith(expectedHistoryQuery(activityKeyFor(mail, null)));
    expect(events.findOne).not.toHaveBeenCalledWith({ userId, ownerName: 'Mail' });
  });
});

describe('findRecentPageDecision', () => {
  beforeEach(() => jest.clearAllMocks());
  const page = { pageCorrectionKey: 'page-key', title: 'Study notes', browser: 'firefox' };
  const now = 1_700_000_000_000;

  test('looks up only resolved model decisions for the same page inside a fixed window', async () => {
    mockHistoryResult();
    const result = await findRecentPageDecision(userId, page, classificationContextFingerprint, now);
    expect(result).toMatchObject({ categoryId: 'work' });
    expect(events.findOne).toHaveBeenCalledWith({
      userId,
      pageCorrectionKey: 'page-key',
      title: 'Study notes',
      classificationContextFingerprint,
      classificationStatus: 'ollama',
      classificationBasis: { $in: ['visible_relevance', 'visible_conflict'] },
      categoryId: { $ne: null },
      timestamp: { $gte: now - RECENT_PAGE_DECISION_MAX_AGE_MS },
    });
    expect(RECENT_PAGE_DECISION_MAX_AGE_MS).toBe(10 * 60 * 1000);
  });

  test('never queries for other browsers, native apps or pages without a stable key', async () => {
    for (const candidate of [
      { ...page, browser: 'chrome' },
      { ...page, browser: null },
      { ...page, pageCorrectionKey: null },
    ]) {
      await expect(
        findRecentPageDecision(userId, candidate, classificationContextFingerprint, now)
      ).resolves.toBeNull();
    }
    expect(events.findOne).not.toHaveBeenCalled();
  });

  test('returns null when nothing recent exists or the lookup fails', async () => {
    events.findOne.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(null),
    });
    await expect(
      findRecentPageDecision(userId, page, classificationContextFingerprint, now)
    ).resolves.toBeNull();
    events.findOne.mockImplementation(() => {
      throw new Error('database unavailable');
    });
    await expect(
      findRecentPageDecision(userId, page, classificationContextFingerprint, now)
    ).resolves.toBeNull();
  });
});
