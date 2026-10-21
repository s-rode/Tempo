export interface DistractionSoundPermit {
  allowed: boolean;
  retryAfterMs: number;
}

export function clampDistractionSoundInterval(value: number): number {
  return Number.isFinite(value) ? Math.max(5_000, Math.min(300_000, Math.round(value))) : 30_000;
}
