import type { DistractionNudge } from '../../../../shared/distractionNudge';

type Attempt = { key: string; controller: AbortController; promise: Promise<DistractionNudge | null> };
const attempts = new Map<string, Attempt>();

/** A new foreground capture cancels optional copy before core inference starts. */
export function cancelDistractionNudge(userId: string): void {
  attempts.get(userId)?.controller.abort();
  attempts.delete(userId);
}

/** Coalesce concurrent requests and remember failures; reminders never retry inference. */
export function requestDistractionNudge(
  userId: string,
  key: string,
  generate: (signal: AbortSignal) => Promise<DistractionNudge | null>
): Promise<DistractionNudge | null> {
  const previous = attempts.get(userId);
  if (previous?.key === key) return previous.promise;
  cancelDistractionNudge(userId);
  const controller = new AbortController();
  const promise = Promise.resolve()
    .then(() => controller.signal.aborted ? null : generate(controller.signal))
    .then(copy => controller.signal.aborted ? null : copy)
    .catch(() => null);
  attempts.set(userId, { key, controller, promise });
  while (attempts.size > 32) cancelDistractionNudge(attempts.keys().next().value!);
  return promise;
}
