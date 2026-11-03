export type AppRuleState = 'productive' | 'unproductive';

export interface AppRule {
  /** Normalized owner name; the match key. */
  appKey: string;
  /** Name as the user entered or picked it. */
  appName: string;
  state: AppRuleState;
}

export const MAX_APP_RULES = 50;

/** App names match case-insensitively, ignoring surrounding and repeated whitespace. */
export const normalizeAppKey = (name: string | null | undefined): string =>
  (name || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

/** Returns the rule for an app, ignoring system events such as lock and sleep. */
export function findAppRule(
  rules: ReadonlyArray<AppRule> | null | undefined,
  activity: { ownerName?: string | null; type?: string | null }
): AppRule | null {
  if (!rules?.length || activity.type === 'system') return null;
  const key = normalizeAppKey(activity.ownerName);
  return key ? rules.find((rule) => rule.appKey === key) || null : null;
}
