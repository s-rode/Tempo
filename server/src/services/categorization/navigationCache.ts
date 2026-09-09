import { ClassificationStatus } from './provider';

/**
 * Only a direct, OCR-backed core decision may seed Firefox's exact-document
 * cache. In particular, a cached result must never become the source for a
 * later cache hit: if an old navigation identity is ever stale, recursively
 * reusing it would keep the wrong category alive indefinitely.
 */
const cacheSeedStatuses = new Set<ClassificationStatus>([
  'deterministic_direct',
  'ollama',
  'policy_override',
]);

type FirefoxNavigationCacheSource = {
  title?: string | null;
  categoryId?: string | null;
  classificationStatus?: ClassificationStatus | null;
};

/**
 * The native bridge's navigation fingerprint identifies an exact document,
 * but title equality is an important independent guard. Firefox can briefly
 * expose a previous tab's bridge state while macOS has already reported a new
 * window title. Never let that transient mismatch skip the fresh OCR capture.
 */
export const isReusableFirefoxNavigationSource = (
  source: FirefoxNavigationCacheSource | null | undefined,
  currentTitle: string
): boolean =>
  Boolean(
    source?.categoryId &&
      source.title === currentTitle &&
      source.classificationStatus &&
      cacheSeedStatuses.has(source.classificationStatus)
  );
