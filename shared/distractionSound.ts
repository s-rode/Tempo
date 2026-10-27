export interface DistractionSoundPermit {
  allowed: boolean;
  retryAfterMs: number;
}

export const DISTRACTION_SOUNDS = [
  { id: 'pop', name: 'Pop', description: 'Soft, rounded tap' },
  { id: 'tink', name: 'Tink', description: 'Light, bright tick' },
  { id: 'purr', name: 'Purr', description: 'Gentle flutter' },
  { id: 'glass', name: 'Glass', description: 'Clear glass chime' },
  { id: 'ping', name: 'Ping', description: 'Bright bell' },
  { id: 'submarine', name: 'Submarine', description: 'Low, rounded tone' },
] as const;

export type DistractionSoundId = (typeof DISTRACTION_SOUNDS)[number]['id'];
export const DEFAULT_DISTRACTION_SOUND: DistractionSoundId = 'pop';

export function resolveDistractionSound(value: unknown) {
  return DISTRACTION_SOUNDS.find((sound) => sound.id === value) || DISTRACTION_SOUNDS[0];
}

export function clampDistractionSoundInterval(value: number): number {
  return Number.isFinite(value) ? Math.max(5_000, Math.min(300_000, Math.round(value))) : 30_000;
}
