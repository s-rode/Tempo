import { describe, expect, test } from 'bun:test';
import type { GoalTask } from '../models/goalPlan';
import {
  addDays,
  carryOver,
  insertOpenTask,
  isDateKey,
  normalizeTasks,
  removeTask,
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
