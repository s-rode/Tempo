import { describe, expect, test } from 'bun:test';
import {
  advanceRuntime,
  createCustomRun,
  createPomodoroRun,
  extendTaskRun,
  continueFinishedSession,
  runtimeSnapshot,
  freezePhase,
  resumePhase,
  completeRun,
  shouldAwaitFreshSystemCapture,
} from './focusRuntime';

const runtimeWith = (run: any): any => ({
  run,
  manualPauseUntilMs: null,
  manualPausedAtMs: null,
  systemLocked: false,
  systemSleeping: false,
  awaitingSystemResumeCapture: false,
  transitionNotice: null,
  acknowledgedTransitionNoticeId: null,
});

describe('estimated task work time', () => {
  const source = { taskId: 'task-123', dateKey: '2026-10-04' };

  test('custom target becomes a single persistent checkpoint and counts overtime', () => {
    const runtime = runtimeWith(createCustomRun('Review algorithms', 45, 1_000, source, 45));
    const targetAt = 1_000 + 45 * 60_000;
    advanceRuntime(runtime, targetAt, { emitTransitionNotice: true });
    const noticeId = runtime.transitionNotice.id;
    expect(runtime.transitionNotice.kind).toBe('task_target_reached');
    expect(runtime.run.state).toBe('active');
    advanceRuntime(runtime, targetAt + 11 * 60_000, { emitTransitionNotice: true });
    expect(runtime.transitionNotice.id).toBe(noticeId);
    expect(runtimeSnapshot(runtime, targetAt + 11 * 60_000).taskProgress?.workElapsedMs).toBe(
      56 * 60_000
    );
    expect(runtimeSnapshot(runtime, targetAt + 11 * 60_000).nextDeadlineAtMs).toBeNull();
    expect(extendTaskRun(runtime, 10, targetAt + 11 * 60_000)).toBe(true);
    expect(runtime.run.taskTarget.estimatedMinutes).toBe(45);
    expect(runtime.run.taskTarget.workTargetMs).toBe(66 * 60_000);
    advanceRuntime(runtime, targetAt + 21 * 60_000, { emitTransitionNotice: true });
    expect(runtime.transitionNotice.kind).toBe('task_target_reached');
    expect(runtime.transitionNotice.id).not.toBe(noticeId);
  });

  test('task Pomodoro schedules exact 30/5/15 and automatically resumes after break', () => {
    const runtime = runtimeWith(createPomodoroRun('Flashcards', 1_000, source, 45, 45));
    expect(
      runtime.run.phases.map((phase: any) => [phase.kind, phase.plannedDurationMs / 60_000])
    ).toEqual([
      ['work', 30],
      ['short_break', 5],
      ['work', 15],
    ]);
    advanceRuntime(runtime, 1_000 + 30 * 60_000, { emitTransitionNotice: true });
    expect(runtime.run.currentPhaseIndex).toBe(1);
    advanceRuntime(runtime, 1_000 + 35 * 60_000, { emitTransitionNotice: true });
    expect(runtime.run.currentPhaseIndex).toBe(2);
    expect(runtime.run.phases[2].state).toBe('running');
    expect(runtime.run.phases[2].goal).toBe('Flashcards');
    advanceRuntime(runtime, 1_000 + 50 * 60_000, { emitTransitionNotice: true });
    expect(runtime.run.state).toBe('active');
    expect(runtime.transitionNotice.kind).toBe('task_target_reached');
    expect(runtime.run.phases.length).toBe(3);
  });

  test('90-minute task Pomodoro completes three work blocks without a final break', () => {
    const runtime = runtimeWith(createPomodoroRun('Algorithms', 1_000, source, 90, 90));
    const boundaries = [30, 35, 65, 70, 100].map((minutes) => 1_000 + minutes * 60_000);
    for (const at of boundaries) advanceRuntime(runtime, at, { emitTransitionNotice: true });
    expect(runtime.run.currentPhaseIndex).toBe(4);
    expect(runtime.run.phases.length).toBe(5);
    expect(runtime.run.state).toBe('active');
    expect(runtime.transitionNotice.kind).toBe('task_target_reached');
    expect(runtimeSnapshot(runtime, boundaries[4]).taskProgress?.workElapsedMs).toBe(90 * 60_000);
  });

  test('early completion keeps recorded work and never requires the target checkpoint', () => {
    const runtime = runtimeWith(createCustomRun('Exercises', 90, 1_000, source, 90));
    completeRun(runtime, 16 * 60_000, 'completed');
    expect(runtime.run.state).toBe('completed');
    expect(runtime.run.phases[0].activeElapsedMs).toBe(16 * 60_000 - 1_000);
    expect(runtime.transitionNotice).toBeNull();
  });

  test('a 90-minute Focus task is one work phase and rejects extensions past the work cap', () => {
    const runtime = runtimeWith(createCustomRun('Algorithms', 90, 1_000, source, 90));
    expect(runtime.run.phases).toHaveLength(1);
    advanceRuntime(runtime, 1_000 + 90 * 60_000, { emitTransitionNotice: true });
    expect(runtime.transitionNotice.kind).toBe('task_target_reached');
    expect(extendTaskRun(runtime, 720, 1_000 + 23 * 60 * 60_000)).toBe(false);
    expect(runtime.run.taskTarget.workTargetMs).toBe(90 * 60_000);
  });

  test('a long Pomodoro extension inserts only necessary intermediate breaks', () => {
    const runtime = runtimeWith(createPomodoroRun('Exercises', 1_000, source, 90, 90));
    expect(runtime.run.phases.map((phase: any) => phase.kind)).toEqual([
      'work',
      'short_break',
      'work',
      'short_break',
      'work',
    ]);
    runtime.run.currentPhaseIndex = 4;
    runtime.run.phases[0].activeElapsedMs = 30 * 60_000;
    runtime.run.phases[0].state = 'completed';
    runtime.run.phases[0].runningSinceMs = null;
    runtime.run.phases[2].activeElapsedMs = 30 * 60_000;
    runtime.run.phases[2].state = 'completed';
    runtime.run.phases[2].runningSinceMs = null;
    const final = runtime.run.phases[4];
    final.state = 'running';
    final.runningSinceMs = 31 * 60_000;
    final.activeElapsedMs = 30 * 60_000;
    runtime.run.taskTarget.checkpointAtMs = 31 * 60_000;
    expect(extendTaskRun(runtime, 40, 31 * 60_000)).toBe(true);
    expect(
      runtime.run.phases
        .slice(5)
        .map((phase: any) => [phase.kind, phase.plannedDurationMs / 60_000])
    ).toEqual([
      ['short_break', 5],
      ['work', 10],
    ]);
    expect(final.plannedDurationMs).toBe(60 * 60_000);
  });

  test('manual pause does not count toward the task work target', () => {
    const runtime = runtimeWith(createCustomRun('Review', 45, 1_000, source, 45));
    freezePhase(runtime, 11_000);
    runtime.manualPauseUntilMs = 71_000;
    expect(runtimeSnapshot(runtime, 61_000).taskProgress?.workElapsedMs).toBe(10_000);
    runtime.manualPauseUntilMs = null;
    resumePhase(runtime, 71_000);
    expect(runtimeSnapshot(runtime, 81_000).taskProgress?.workElapsedMs).toBe(20_000);
  });
});

describe('continuing a finished focus session', () => {
  const finishedCustom = () => {
    const runtime = runtimeWith(createCustomRun('Review probability notes', 15, 1_000));
    advanceRuntime(runtime, 901_000, { emitTransitionNotice: true });
    const finished = structuredClone(runtime.run);
    runtime.run = null; // Normal reconciliation has archived the completed run.
    return { runtime, finished };
  };

  test('continues the same goal from the click without changing history or charging the gap', () => {
    const { runtime, finished } = finishedCustom();
    const before = structuredClone(finished);
    const noticeId = runtime.transitionNotice.id;
    // Delivery acknowledgement happens before the user acts on the notch.
    runtime.acknowledgedTransitionNoticeId = noticeId;
    expect(continueFinishedSession(runtime, finished, noticeId, 10, 1_501_000)).toBe(true);
    const snapshot = runtimeSnapshot(runtime, 1_501_000);
    expect(snapshot.mode).toBe('custom');
    expect(snapshot.currentPhase?.goal).toBe('Review probability notes');
    expect(snapshot.currentPhase?.activeElapsedMs).toBe(0);
    expect(snapshot.phaseRemainingMs).toBe(600_000);
    expect(snapshot.nextDeadlineAtMs).toBe(2_101_000);
    expect(snapshot.transitionNotice).toBeNull();
    expect(finished).toEqual(before);
    expect(runtime.run.id).not.toBe(finished.id);
    advanceRuntime(runtime, 2_101_000, { emitTransitionNotice: true });
    expect(runtime.transitionNotice.kind).toBe('focus_complete');
    expect(runtime.transitionNotice.id).not.toBe(noticeId);
  });

  test('rejects stale notices, unrelated history, duplicate clicks, and invalid durations', () => {
    const { runtime, finished } = finishedCustom();
    const noticeId = runtime.transitionNotice.id;
    expect(continueFinishedSession(runtime, finished, 'stale', 10)).toBe(false);
    expect(continueFinishedSession(runtime, { ...finished, id: 'other' }, noticeId, 10)).toBe(
      false
    );
    expect(
      continueFinishedSession(runtime, { ...finished, state: 'cancelled' }, noticeId, 10)
    ).toBe(false);
    for (const minutes of [0, -1, 1.5, 721, NaN])
      expect(continueFinishedSession(runtime, finished, noticeId, minutes)).toBe(false);
    expect(runtime.run).toBeNull();
    expect(continueFinishedSession(runtime, finished, noticeId, 5, 1_501_000)).toBe(true);
    const newRunId = runtime.run.id;
    expect(continueFinishedSession(runtime, finished, noticeId, 5, 1_501_001)).toBe(false);
    expect(runtime.run.id).toBe(newRunId);
  });

  test('continues the last Pomodoro goal with just the requested work block', () => {
    const run = createPomodoroRun('First goal', 1_000);
    run.phases[6].goal = 'Last goal';
    run.phases[6].todayPlanTask = { taskId: 'task-123', dateKey: '2026-10-27' };
    run.currentPhaseIndex = 7;
    Object.assign(run.phases[7], { state: 'running', runningSinceMs: 1_000 });
    const runtime = runtimeWith(run);
    advanceRuntime(runtime, 1_801_000, { emitTransitionNotice: true });
    const finished = structuredClone(runtime.run);
    runtime.run = null;
    expect(
      continueFinishedSession(runtime, finished, runtime.transitionNotice.id, 30, 1_901_000)
    ).toBe(true);
    expect(runtime.run.kind).toBe('custom');
    expect(runtime.run.phases).toHaveLength(1);
    expect(runtime.run.phases[0].goal).toBe('Last goal');
    expect(runtime.run.phases[0].todayPlanTask).toEqual(run.phases[6].todayPlanTask);
    expect(runtime.run.taskTarget).toBeNull();
    expect(runtimeSnapshot(runtime, 1_901_000).phaseRemainingMs).toBe(30 * 60_000);
  });

  test('honors sleep, fresh-capture gates, and manual pauses when continuing', () => {
    for (const suspension of [
      { systemSleeping: true },
      { systemLocked: true },
      { awaitingSystemResumeCapture: true },
      { manualPauseUntilMs: 2_000_000 },
    ]) {
      const { runtime, finished } = finishedCustom();
      Object.assign(runtime, suspension);
      expect(
        continueFinishedSession(runtime, finished, runtime.transitionNotice.id, 10, 1_501_000)
      ).toBe(true);
      expect(runtime.run.phases[0].state).toBe('suspended');
      expect(runtime.run.phases[0].runningSinceMs).toBeNull();
      expect(runtimeSnapshot(runtime, 1_601_000).currentPhase?.activeElapsedMs).toBe(0);
    }
  });
});

describe('focus transition notices', () => {
  test('does not deadlock wake recovery behind an intentional capture pause', () => {
    const normal = runtimeWith(null);
    expect(shouldAwaitFreshSystemCapture(normal, 1_000)).toBe(true);

    const awaitingGoal = runtimeWith(createPomodoroRun('First block', 1_000));
    awaitingGoal.run.currentPhaseIndex = 2;
    awaitingGoal.run.phases[2].state = 'awaiting_goal';
    expect(shouldAwaitFreshSystemCapture(awaitingGoal, 1_000)).toBe(false);

    const manuallyPaused = runtimeWith(createCustomRun('Focused work', 30, 1_000));
    manuallyPaused.manualPauseUntilMs = 61_000;
    expect(shouldAwaitFreshSystemCapture(manuallyPaused, 1_000)).toBe(false);

    const onBreak = runtimeWith(
      createPomodoroRun('Flashcards', 1_000, { taskId: 'task-123', dateKey: '2026-10-04' }, 45, 45)
    );
    onBreak.run.currentPhaseIndex = 1;
    onBreak.run.phases[1].state = 'running';
    expect(shouldAwaitFreshSystemCapture(onBreak, 1_000)).toBe(false);
  });

  test('records one notice for a naturally completed custom focus phase', () => {
    const run = createCustomRun('Review probability notes', 15, 1_000);
    run.phases[0].plannedDurationMs = 1_000;
    const runtime = runtimeWith(run);

    advanceRuntime(runtime, 2_000, { emitTransitionNotice: true });

    expect(runtime.run.state).toBe('completed');
    expect(runtime.transitionNotice).toMatchObject({
      kind: 'focus_complete',
      goal: 'Review probability notes',
      phaseIndex: 0,
    });
  });

  test('retains the Today’s Plan source only on the chosen work phase', () => {
    const taskSource = { taskId: 'task-123', dateKey: '2026-09-09' };
    const custom = createCustomRun('Review the lecture notes', 30, 1_000, taskSource);
    const pomodoro = createPomodoroRun('Solve exercise 4', 1_000, taskSource);

    expect(custom.phases[0].goal).toBe('Review the lecture notes');
    expect(custom.phases[0].todayPlanTask).toEqual(taskSource);
    expect(pomodoro.phases[0].todayPlanTask).toEqual(taskSource);
    expect(pomodoro.phases[2].todayPlanTask).toBeNull();
  });

  test('records the initial goal boundary for a running work phase', () => {
    const taskSource = { taskId: 'task-123', dateKey: '2026-09-09' };
    const run = createCustomRun('Review lecture notes', 30, 12_345, taskSource);

    expect(run.phases[0].goalHistory).toEqual([
      { goal: 'Review lecture notes', todayPlanTask: taskSource, startedAtMs: 12_345 },
    ]);
  });

  test('announces a Pomodoro break after each naturally completed work phase', () => {
    const run = createPomodoroRun('Solve practice problems', 1_000);
    run.phases[0].plannedDurationMs = 1_000;
    const runtime = runtimeWith(run);

    advanceRuntime(runtime, 2_000, { emitTransitionNotice: true });

    expect(runtime.run.currentPhaseIndex).toBe(1);
    expect(runtime.run.phases[1].state).toBe('running');
    expect(runtime.transitionNotice).toMatchObject({
      kind: 'break_started',
      goal: 'Solve practice problems',
      breakDurationMs: runtime.run.phases[1].plannedDurationMs,
    });
  });

  test('asks for a goal after a naturally completed short break', () => {
    const run = createPomodoroRun('First block', 1_000);
    run.currentPhaseIndex = 1;
    run.phases[1].state = 'running';
    run.phases[1].runningSinceMs = 1_000;
    run.phases[1].startedAtMs = 1_000;
    run.phases[1].plannedDurationMs = 1_000;
    const runtime = runtimeWith(run);

    advanceRuntime(runtime, 2_000, { emitTransitionNotice: true });

    expect(runtime.run.currentPhaseIndex).toBe(2);
    expect(runtime.run.phases[2].state).toBe('awaiting_goal');
    expect(runtime.transitionNotice).toMatchObject({ kind: 'break_complete', goal: null });
  });

  test('only the final long break completes a Pomodoro run', () => {
    const run = createPomodoroRun('First block', 1_000);
    run.currentPhaseIndex = 7;
    run.phases[7].state = 'running';
    run.phases[7].runningSinceMs = 1_000;
    run.phases[7].startedAtMs = 1_000;
    run.phases[7].plannedDurationMs = 1_000;
    run.phases[6].goal = 'Final block';
    const runtime = runtimeWith(run);

    advanceRuntime(runtime, 2_000, { emitTransitionNotice: true });

    expect(runtime.run.state).toBe('completed');
    expect(runtime.transitionNotice).toMatchObject({
      kind: 'pomodoro_complete',
      goal: 'Final block',
    });
  });

  test('silent reconciliation, pauses, and system suspension create no notice', () => {
    const completedSilently = runtimeWith(createCustomRun('Quiet completion', 15, 1_000));
    completedSilently.run.phases[0].plannedDurationMs = 1_000;
    advanceRuntime(completedSilently, 2_000);
    expect(completedSilently.transitionNotice).toBeNull();

    const paused = runtimeWith(createCustomRun('Paused focus', 15, 1_000));
    paused.run.phases[0].state = 'suspended';
    paused.run.phases[0].runningSinceMs = null;
    paused.manualPauseUntilMs = 2_000;
    advanceRuntime(paused, 2_000, { emitTransitionNotice: true });
    expect(paused.transitionNotice).toBeNull();

    const sleeping = runtimeWith(createCustomRun('Sleeping focus', 15, 1_000));
    sleeping.run.phases[0].plannedDurationMs = 1_000;
    sleeping.systemSleeping = true;
    advanceRuntime(sleeping, 3_000, { emitTransitionNotice: true });
    expect(sleeping.transitionNotice).toBeNull();
    expect(sleeping.run.state).toBe('active');
  });
});
