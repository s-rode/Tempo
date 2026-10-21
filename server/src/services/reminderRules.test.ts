import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_REMINDER_FILTER,
  type NativeReminder,
  type ReminderFilter,
} from '../../../shared/reminders';
import { matchesReminderFilter, reminderClassificationText, reminderDueDay } from './reminderRules';
import { applyReminderContextToRun, reminderSyncSchema } from './reminders';
import {
  createCustomRun,
  createPomodoroRun,
  advanceRuntime,
  runtimeSnapshot,
} from './focusRuntime';
import {
  buildGoalSupportProfilePromptInput,
  buildSemanticActivityPromptInput,
} from './categorization/llm';
import {
  fingerprintClassificationContext,
  fingerprintEffectiveGoalContext,
  fingerprintGoalText,
} from './goalPlans';

const now = Date.parse('2026-10-20T10:00:00+02:00');
const reminder = (change: Partial<NativeReminder> = {}): NativeReminder => ({
  sourceId: 'opaque-apple-id',
  title: 'Lecture Week 2',
  listId: 'ml',
  due: { year: 2026, month: 10, day: 20 },
  completed: false,
  ...change,
});
const matches = (item: NativeReminder, filter = DEFAULT_REMINDER_FILTER, timestamp = now) =>
  matchesReminderFilter(item, filter, timestamp, 'Europe/Berlin');

describe('reminder filters and dates', () => {
  test('default includes today and overdue, excludes future, undated, and completed', () => {
    expect(matches(reminder())).toBe(true);
    expect(matches(reminder({ due: { year: 2026, month: 10, day: 19 } }))).toBe(true);
    expect(matches(reminder({ due: { year: 2026, month: 10, day: 21 } }))).toBe(false);
    expect(matches(reminder({ due: null }))).toBe(false);
    expect(matches(reminder({ completed: true }))).toBe(false);
  });
  test('supports OR, AND, multi-list membership, and missing lists without broadening', () => {
    const filter: ReminderFilter = {
      match: 'any',
      rules: [{ kind: 'due_today' }, { kind: 'list', listIds: ['work', 'ml'] }],
    };
    expect(matches(reminder({ due: null }), filter)).toBe(true);
    expect(matches(reminder({ due: null }), { ...filter, match: 'all' })).toBe(false);
    expect(matches(reminder(), { ...filter, match: 'all' })).toBe(true);
    expect(
      matches(reminder(), { match: 'all', rules: [{ kind: 'list', listIds: ['deleted-list'] }] })
    ).toBe(false);
    expect(matches(reminder(), { match: 'any', rules: [{ kind: 'list', listIds: [] }] })).toBe(
      false
    );
  });
  test('empty rules show all unfinished items; explicit undated and future rules work', () => {
    for (const match of ['any', 'all'] as const)
      expect(matches(reminder({ due: null }), { match, rules: [] })).toBe(true);
    expect(
      matches(reminder({ due: null }), { match: 'any', rules: [{ kind: 'no_due_date' }] })
    ).toBe(true);
    expect(
      matches(reminder({ due: { year: 2026, month: 10, day: 21 } }), {
        match: 'any',
        rules: [{ kind: 'due_later' }],
      })
    ).toBe(true);
  });
  test('date-only reminders remain calendar dates across DST and midnight', () => {
    const item = reminder({ due: { year: 2026, month: 10, day: 25 } });
    const filter: ReminderFilter = { match: 'any', rules: [{ kind: 'due_today' }] };
    expect(matches(item, filter, Date.parse('2026-10-25T00:05:00+02:00'))).toBe(true);
    expect(matches(item, filter, Date.parse('2026-10-25T23:55:00+01:00'))).toBe(true);
    expect(matches(item, filter, Date.parse('2026-10-26T00:05:00+01:00'))).toBe(false);
    expect(reminderDueDay(item.due!, 'America/Los_Angeles')).toBe('2026-10-25');
  });
  test('zoned timed deadlines use the Mac calendar day while floating deadlines retain their components', () => {
    const due = {
      year: 2026,
      month: 10,
      day: 19,
      hour: 23,
      minute: 30,
      timeZone: 'America/Los_Angeles',
      timestampMs: Date.parse('2026-10-19T23:30:00-07:00'),
    };
    expect(reminderDueDay(due, 'Europe/Berlin')).toBe('2026-10-20');
    expect(
      reminderDueDay({ year: 2026, month: 10, day: 19, hour: 23, minute: 30 }, 'Europe/Berlin')
    ).toBe('2026-10-19');
  });
});

describe('reminder context and session provenance', () => {
  test('inherits list intent, replaces it with custom intent, and falls back when blank', () => {
    const listIntent = 'Watch ML lectures and create related flashcards in RemNote.';
    expect(
      reminderClassificationText('Lecture Week 2', 'Machine Learning', '', listIntent)
    ).toContain(listIntent);
    const override = reminderClassificationText(
      'Lecture Week 2',
      'Machine Learning',
      'Review existing flashcards only.',
      listIntent
    );
    expect(override).toContain('Review existing flashcards only.');
    expect(override).not.toContain(listIntent);
    expect(
      reminderClassificationText('Lecture Week 2', 'Machine Learning', '  ', listIntent)
    ).toContain(listIntent);
    expect(reminderClassificationText('Lecture Week 2', 'Machine Learning')).toBe(
      'Lecture Week 2\nList: Machine Learning'
    );
  });
  test('richer context reaches profiling and invalidates both classification and correction scope', () => {
    const text = reminderClassificationText(
      'Lecture Week 2',
      'ML',
      '',
      'Watch lectures and make flashcards'
    );
    const context = (classificationText: string) => ({
      scope: 'daily' as const,
      primaryGoal: 'Lecture Week 2',
      dailyTasks: ['Lecture Week 2'],
      targets: [
        {
          ref: 'reminder:id',
          scope: 'daily' as const,
          text: 'Lecture Week 2',
          classificationText,
          textFingerprint: fingerprintGoalText(classificationText),
          supportProfile: null,
        },
      ],
    });
    expect(buildGoalSupportProfilePromptInput(text)[1].content).toContain('make flashcards');
    expect(
      buildGoalSupportProfilePromptInput('x'.repeat(500) + '\nFocus context: make flashcards')[1]
        .content
    ).toContain('make flashcards');
    expect(fingerprintEffectiveGoalContext(context(text))).not.toBe(
      fingerprintEffectiveGoalContext(context(text + ' instead review only'))
    );
    expect(fingerprintClassificationContext(context(text))).not.toBe(
      fingerprintClassificationContext(context(text + ' instead review only'))
    );
    const prompt = buildSemanticActivityPromptInput(
      context(text),
      { ownerName: 'RemNote', title: 'Week 2', browser: 'firefox' },
      [],
      'strict'
    );
    expect(JSON.stringify(prompt)).toContain('make flashcards');
    expect(JSON.stringify(prompt)).toContain('visible');
  });
  test('context changes preserve earlier segments, estimate, timer, and short display title', () => {
    const source = {
      taskId: 'task-1',
      dateKey: '2026-10-20',
      source: 'reminder' as const,
      classificationText: 'Old intent',
    };
    const run = createCustomRun('Lecture Week 2', 45, now, source, 45);
    expect(applyReminderContextToRun(run, 'task-1', 'New intent', now + 1000)).toBe(true);
    expect(run.phases[0].goal).toBe('Lecture Week 2');
    expect(run.phases[0].runningSinceMs).toBe(now);
    expect(run.taskTarget?.estimatedMinutes).toBe(45);
    expect(run.phases[0].goalHistory).toHaveLength(2);
    expect(run.phases[0].goalHistory[0].todayPlanTask?.classificationText).toBe('Old intent');
    expect(run.phases[0].goalHistory[1].todayPlanTask?.classificationText).toBe('New intent');
    expect(applyReminderContextToRun(run, 'task-1', 'New intent', now + 2000)).toBe(false);
  });
  test('completed work keeps its context; future Pomodoro blocks carry the updated reminder source', () => {
    const source = {
      taskId: 'task-1',
      dateKey: '2026-10-20',
      source: 'reminder' as const,
      classificationText: 'Old intent',
    };
    const run = createPomodoroRun('Lecture Week 2', now, source, 45, 45);
    const runtime = { run, revision: 0 };
    advanceRuntime(runtime, now + 30 * 60_000);
    expect(applyReminderContextToRun(run, 'task-1', 'New intent', now + 31 * 60_000)).toBe(true);
    expect(run.phases[0].todayPlanTask?.classificationText).toBe('Old intent');
    advanceRuntime(runtime, now + 35 * 60_000);
    expect(run.phases[2].todayPlanTask).toMatchObject({
      source: 'reminder',
      classificationText: 'New intent',
    });
    expect(run.phases[2].goalHistory[0].todayPlanTask?.source).toBe('reminder');
    expect(runtimeSnapshot(runtime, now + 35 * 60_000).taskProgress?.source).toBe('reminder');
  });
  test('rejects incomplete and malformed payloads before persistence', () => {
    expect(
      reminderSyncSchema.safeParse({
        enabled: true,
        permission: 'granted',
        snapshot: { lists: [] },
      }).success
    ).toBe(false);
    expect(
      reminderSyncSchema.safeParse({
        enabled: true,
        permission: 'granted',
        snapshot: { lists: [], reminders: [reminder({ due: { year: 2026, month: 2, day: 30 } })] },
      }).success
    ).toBe(false);
  });
});
