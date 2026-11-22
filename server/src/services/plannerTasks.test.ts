import { describe, expect, test } from 'bun:test';
import type { GoalTask } from '../models/goalPlan';
import {
  addDays,
  carryOver,
  insertOpenTask,
  isDateKey,
  normalizeTasks,
  rememberedGoals,
  removeTask,
  repeatsOn,
  taskNameKey,
  weekDayKeys,
  weekStartOf,
} from './plannerTasks';

const task = (id: string, position: number, completedAtMs: number | null = null): GoalTask => ({
  id,
  text: id,
  position,
  completedAtMs,
});
const ids = (tasks: GoalTask[]) => tasks.map((entry) => entry.id);

describe('planner task helpers', () => {
  test('recognizes real calendar days only', () => {
    expect(isDateKey('2026-11-18')).toBe(true);
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('18.11.2026')).toBe(false);
  });

  test('weeks start on Monday and survive month and year edges', () => {
    expect(weekStartOf('2026-11-18')).toBe('2026-11-16');
    expect(weekStartOf('2026-11-16')).toBe('2026-11-16');
    expect(weekStartOf('2026-11-22')).toBe('2026-11-16');
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
    expect(weekDayKeys('2026-12-28')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  });

  test('inserting clamps the index and keeps finished tasks after the queue', () => {
    const day = [task('a', 0), task('b', 1), task('done', 0, 5)];
    expect(ids(insertOpenTask(day, task('new', 0), 1))).toEqual(['a', 'new', 'b', 'done']);
    expect(ids(insertOpenTask(day, task('new', 0), 99))).toEqual(['a', 'b', 'new', 'done']);
    expect(ids(insertOpenTask(day, task('new', 0), -3))).toEqual(['new', 'a', 'b', 'done']);
    expect(insertOpenTask(day, task('new', 0), 1).map((entry) => entry.position)).toEqual([
      0, 1, 2, 0,
    ]);
  });

  test('moving inside one day reorders without duplicating', () => {
    const day = [task('a', 0), task('b', 1), task('c', 2)];
    expect(ids(insertOpenTask(day, day[2], 0))).toEqual(['c', 'a', 'b']);
  });

  test('a finished task dropped into a queue becomes open again', () => {
    const moved = insertOpenTask([task('a', 0)], task('was-done', 0, 9), 0);
    expect(moved[0]).toMatchObject({ id: 'was-done', completedAtMs: null, position: 0 });
  });

  test('removing renumbers the remaining queue', () => {
    const left = removeTask([task('a', 0), task('b', 1), task('c', 2)], 'a');
    expect(left.map((entry) => [entry.id, entry.position])).toEqual([
      ['b', 0],
      ['c', 1],
    ]);
  });

  test('normalizing repairs gaps in positions', () => {
    expect(
      normalizeTasks([task('b', 7), task('a', 3)]).map((entry) => [entry.id, entry.position])
    ).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });

  test('unfinished tasks carry over oldest day first and remember their first day', () => {
    const carried = carryOver(
      [task('today', 0), task('today-done', 0, 3)],
      [
        { dateKey: '2026-11-17', tasks: [task('tue', 0), task('tue-done', 0, 2)] },
        {
          dateKey: '2026-11-16',
          tasks: [{ ...task('mon', 0), carriedFromDateKey: '2026-11-13' }],
        },
      ]
    );
    expect(ids(carried)).toEqual(['today', 'mon', 'tue', 'today-done']);
    expect(carried[1].carriedFromDateKey).toBe('2026-11-13');
    expect(carried[2].carriedFromDateKey).toBe('2026-11-17');
  });

  test('carrying over twice never duplicates a task', () => {
    const earlier = [{ dateKey: '2026-11-17', tasks: [task('tue', 0)] }];
    const once = carryOver([], earlier);
    expect(ids(carryOver(once, earlier))).toEqual(['tue']);
  });
});

describe('remembered goals', () => {
  const named = (id: string, text: string, goalId: string | null, position = 0): GoalTask => ({
    id,
    text,
    position,
    completedAtMs: null,
    goalId,
  });

  test('a name keeps the goal it was last linked to, ignoring case and spacing', () => {
    const remembered = rememberedGoals(
      [
        { dateKey: '2026-11-20', tasks: [named('b', 'Flashcards', 'masters')] },
        { dateKey: '2026-11-18', tasks: [named('a', 'flashcards', 'language')] },
        { dateKey: '2026-11-21', tasks: [named('c', '  flashcards  ', null)] },
      ],
      new Set(['masters', 'language'])
    );
    expect(remembered).toEqual({ flashcards: 'masters' });
    expect(taskNameKey('  Write  Thesis. ')).toBe('write thesis');
  });

  test('finished or deleted goals fall back to the earlier goal', () => {
    const remembered = rememberedGoals(
      [
        { dateKey: '2026-11-18', tasks: [named('a', 'Gym', 'health')] },
        { dateKey: '2026-11-19', tasks: [named('b', 'Gym', 'finished')] },
      ],
      new Set(['health'])
    );
    expect(remembered).toEqual({ gym: 'health' });
  });
});

describe('repeating tasks', () => {
  test('daily, weekdays and weekly rules', () => {
    // 2026-11-16 is a Monday.
    const daily = { repeat: 'daily' as const, startDateKey: '2026-11-18' };
    expect(repeatsOn(daily, '2026-11-17')).toBe(false);
    expect(repeatsOn(daily, '2026-11-22')).toBe(true);
    const weekdays = { repeat: 'weekdays' as const, startDateKey: '2026-11-16' };
    expect(repeatsOn(weekdays, '2026-11-20')).toBe(true);
    expect(repeatsOn(weekdays, '2026-11-21')).toBe(false);
    const weekly = { repeat: 'weekly' as const, startDateKey: '2026-11-18' };
    expect(repeatsOn(weekly, '2026-11-25')).toBe(true);
    expect(repeatsOn(weekly, '2026-11-26')).toBe(false);
  });
});
