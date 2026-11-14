import { createHash } from 'crypto';

/**
 * Bounded in-memory memo of validated model decisions. Keys are SHA-256 hashes
 * of the complete request, so no activity text is retained as a key, and values
 * are only the parsed decision. Nothing is persisted; it is lost on restart.
 */
export class DecisionCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAtMs: number }>();

  constructor(
    private readonly maxEntries = 512,
    private readonly ttlMs = 6 * 60 * 60 * 1000,
    private readonly now: () => number = Date.now
  ) {}

  static keyFor(parts: unknown): string {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAtMs <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-insert so Map iteration order doubles as least-recently-used order.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry.value);
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value: structuredClone(value), expiresAtMs: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
