import { describe, expect, test } from 'bun:test';
import { ActiveWindowEventModel } from './activeWindowEvent';

describe('active window event display text', () => {
  test('bounds a long window title used as the activity label instead of failing validation', () => {
    const title =
      '(VU) Formale Methoden für Steuerungssoftware(VU) Formal Methods for Logic Control Software: L02a (Recorded on 27.10.2026) | RWTHmoodle';
    const event = new ActiveWindowEventModel({
      userId: 'user',
      ownerName: 'Firefox',
      type: 'browser',
      title,
      activityLabel: title,
      activitySummary: 'x'.repeat(300),
      timestamp: 1,
    });

    expect(event.validateSync()).toBeUndefined();
    expect(event.activityLabel).toBe(title.slice(0, 60));
    expect(event.activitySummary).toHaveLength(120);
    expect(event.title).toBe(title);
  });
});
