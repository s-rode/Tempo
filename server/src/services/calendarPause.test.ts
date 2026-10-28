import { expect, test } from 'bun:test';
import { advanceRuntime, applyCalendarPause, createCustomRun, runtimeSnapshot } from './focusRuntime';
const minute = 60_000;
const runtime = () => ({run: createCustomRun('Review notes', 60, 1000), manualPauseUntilMs: null as number | null, manualPausedAtMs: null as number | null, calendarPauseUntilMs: null as number | null, calendarPausedAtMs: null as number | null, calendarPauseEventIds: [] as string[], awaitingSystemResumeCapture: false, systemSleeping: false});
test('a calendar event freezes focus time and exposes a separate suspension reason', () => {
  const state = runtime();
  expect(applyCalendarPause(state, 1000 + 30 * minute, 1000 + 5 * minute)).toBe(true);
  const snapshot = runtimeSnapshot(state, 1000 + 15 * minute);
  expect(snapshot.suspension.reasons).toContain('calendar_event');
  expect(snapshot.currentPhase.activeElapsedMs).toBe(5 * minute);
  expect(state.run.phases[0].runningSinceMs).toBeNull();
  expect(snapshot.nextDeadlineAtMs).toBe(1000 + 30 * minute);
});
test('ending a calendar pause cannot clear or resume through an independent manual pause', () => {
  const state = runtime();
  state.manualPauseUntilMs = 1000 + 90 * minute;
  state.manualPausedAtMs = 1000;
  applyCalendarPause(state, 1000 + 30 * minute, 1000 + minute);
  applyCalendarPause(state, null, 1000 + 30 * minute);
  expect(state.manualPauseUntilMs).toBe(1000 + 90 * minute);
  expect(runtimeSnapshot(state, 1000 + 30 * minute).suspension.reasons).toEqual(['manual_pause']);
  expect(state.run.phases[0].runningSinceMs).toBeNull();
});
test('event expiry waits for a fresh foreground capture and does not charge the event as focus', () => {
  const state = runtime();
  applyCalendarPause(state, 1000 + 30 * minute, 1000 + 5 * minute);
  advanceRuntime(state, 1000 + 30 * minute);
  expect(state.calendarPauseUntilMs).toBeNull();
  expect(state.awaitingSystemResumeCapture).toBe(true);
  expect(state.run.phases[0].activeElapsedMs).toBe(5 * minute);
  expect(state.run.phases[0].runningSinceMs).toBeNull();
});
test('an overlapping event extension never resets accrued focus or resumes the phase', () => {
  const state = runtime();
  applyCalendarPause(state, 1000 + 30 * minute, 1000 + 5 * minute);
  expect(applyCalendarPause(state, 1000 + 60 * minute, 1000 + 15 * minute)).toBe(false);
  expect(state.run.phases[0].activeElapsedMs).toBe(5 * minute);
  expect(state.calendarPausedAtMs).toBe(1000 + 5 * minute);
});
test('a calendar pause ending during sleep leaves the system gate authoritative', () => {
  const state = runtime();
  applyCalendarPause(state, 1000 + 30 * minute, 1000 + 5 * minute);
  state.systemSleeping = true;
  advanceRuntime(state, 1000 + 60 * minute);
  expect(state.calendarPauseUntilMs).toBeNull();
  expect(runtimeSnapshot(state, 1000 + 60 * minute).suspension.reasons).toContain('system_sleep');
  expect(state.run.phases[0].runningSinceMs).toBeNull();
});
