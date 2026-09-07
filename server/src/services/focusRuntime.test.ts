import { describe, expect, test } from 'bun:test';
import { advanceRuntime, createCustomRun, createPomodoroRun } from './focusRuntime';

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

describe('focus transition notices', () => {
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
