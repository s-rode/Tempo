import { afterEach, describe, expect, test } from 'bun:test';
import { buildCoreClassificationPromptInput } from './llm';
import { OllamaClassificationProvider } from './provider';
import type { EffectiveGoalContext } from '../goalPlans';

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.OLLAMA_BASE_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = originalBaseUrl;
});

const goals: EffectiveGoalContext = {
  scope: 'daily' as const,
  primaryGoal: 'Study Gaussian Processes',
  dailyTasks: ['Study Gaussian Processes'],
  targets: [
    {
      ref: 'daily:today:gp',
      scope: 'daily' as const,
      text: 'Study Gaussian Processes',
      textFingerprint: 'goal-fingerprint',
      supportProfile: {
        subjectCues: ['Gaussian Processes'],
        expectedOutcome: 'Understand Gaussian Processes.',
        supportingModes: ['study_notes_or_retrieval', 'read_reference'],
        revision: 'profile-revision',
      },
    },
  ],
  attentionGuardrail: null,
};
const categories = [
  { name: 'Work', description: 'Goal-related study', isProductive: true },
  { name: 'Distraction', description: 'Unrelated entertainment', isProductive: false },
];
const activity = {
  ownerName: 'Firefox',
  title: 'Gaussian Process tutorial',
  url: 'https://example.test/gp',
  content: 'Gaussian process regression',
  type: 'browser' as const,
  browser: 'chrome' as const,
};

describe('OllamaClassificationProvider', () => {
  test('sends ordered unchecked tasks only and never a longer-term direction', () => {
    const promptInput = buildCoreClassificationPromptInput(
      {
        scope: 'daily',
        primaryGoal: 'Solve the exercise',
        dailyTasks: ['Solve the exercise', 'Read the paper'],
        targets: [
          {
            ref: 'daily:one',
            scope: 'daily',
            text: 'Solve the exercise',
            textFingerprint: 'one',
            supportProfile: null,
          },
          {
            ref: 'daily:two',
            scope: 'daily',
            text: 'Read the paper',
            textFingerprint: 'two',
            supportProfile: null,
          },
        ],
        attentionGuardrail: null,
      },
      categories,
      activity
    );
    const prompt = promptInput[1].content;
    expect(prompt).toContain('[T1] daily target: "Solve the exercise"');
    expect(prompt).toContain('[T2] daily target: "Read the paper"');
    expect(prompt).not.toContain('Life:');
    expect(prompt).not.toContain('longer-term');
    expect(promptInput[0].content).toContain('Never invent hidden work context');
  });

  test('does not permit generic productivity when there is no effective goal', () => {
    const prompt = buildCoreClassificationPromptInput(
      { scope: 'none', primaryGoal: null, dailyTasks: [], targets: [], attentionGuardrail: null },
      categories,
      activity
    )[1].content;
    expect(prompt).toContain('No active productive target');
    expect(prompt).toContain('For uncertain, set c/t/m to null');
  });

  test('uses bounded local structured output without thinking', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = (async (_url: unknown, init: RequestInit | undefined) => {
      const request = JSON.parse(String(init?.body));
      expect(request.stream).toBe(false);
      expect(request.think).toBe(false);
      expect(request.keep_alive).toBe('10m');
      expect(request.options.temperature).toBe(0);
      expect(request.options.num_ctx).toBe(4096);
      expect(request.options.num_predict).toBe(56);
      expect(request.format.required).toEqual(['v', 'c', 't', 'm']);
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              v: 'productive',
              c: 'Work',
              t: 'T1',
              m: 'direct',
            }),
          },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await new OllamaClassificationProvider().classify(goals, categories, activity);
    expect(result.status).toBe('ollama');
    expect(result.choice?.chosenCategoryName).toBe('Work');
    expect(result.choice?.goalRelation).toBe('direct');
    expect(result.attemptCount).toBe(1);
  });

  test('rejects non-loopback Ollama URLs', async () => {
    process.env.OLLAMA_BASE_URL = 'https://example.com';
    const result = await new OllamaClassificationProvider().classify(goals, categories, activity);
    expect(result).toMatchObject({ choice: null, status: 'ollama_unavailable', attemptCount: 1 });
  });

  test('accepts a minimal valid decision', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              chosenCategoryName: 'Distraction',
              confidence: '0.82',
              goalRelation: 'none',
              matchedGoalRef: null,
              supportingMode: null,
              goalEvidence: null,
              activityEvidence: null,
            }),
          },
        }),
        { status: 200 }
      )) as unknown as typeof fetch;

    const result = await new OllamaClassificationProvider().classify(goals, categories, activity);
    expect(result.status).toBe('ollama');
    expect(result.choice).toMatchObject({
      chosenCategoryName: 'Distraction',
      confidence: 0.82,
      matchedGoalRef: null,
    });
  });

  test('expands a compact target alias to the internal target reference', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    const longTargetRef = 'daily:2026-09-09:89c90344-57a4-40fa-9c47-ce84bcd92b92';
    const longGoals: EffectiveGoalContext = {
      ...goals,
      targets: [{ ...goals.targets![0], ref: longTargetRef }],
    };
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              c: 'Work',
              v: 'productive',
              t: 'T1',
              m: 'direct',
            }),
          },
        }),
        { status: 200 }
      )) as unknown as typeof fetch;

    const result = await new OllamaClassificationProvider().classify(
      longGoals,
      categories,
      activity
    );
    expect(result.choice?.matchedGoalRef).toBe(longTargetRef);
  });

  test('accepts a JSON response wrapped in a markdown fence', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          message: {
            content: '```json\n{"v":"productive","c":"Work","t":"T1","m":"direct"}\n```',
          },
        }),
        { status: 200 }
      )) as unknown as typeof fetch;

    const result = await new OllamaClassificationProvider().classify(goals, categories, activity);
    expect(result.choice?.chosenCategoryName).toBe('Work');
  });

  test('retries one malformed core reply with a minimal local request', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          message: {
            content:
              calls === 1
                ? '{bad'
                : JSON.stringify({
                    c: 'Work',
                    v: 'productive',
                    t: 'T1',
                    m: 'direct',
                  }),
          },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    const result = await new OllamaClassificationProvider().classify(goals, categories, activity);
    expect(calls).toBe(2);
    expect(result).toMatchObject({
      status: 'ollama',
      attemptCount: 2,
      choice: { chosenCategoryName: 'Work' },
    });
  });

  test('keeps a recognizable distracting category when optional relation metadata conflicts', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              v: 'productive',
              c: 'Distraction',
              t: 'T1',
              m: 'study_notes_or_retrieval',
            }),
          },
        }),
        { status: 200 }
      )) as unknown as typeof fetch;

    const result = await new OllamaClassificationProvider().classify(goals, categories, activity);
    expect(result.choice).toMatchObject({
      chosenCategoryName: 'Distraction',
      verdict: 'distracting',
      goalRelation: 'none',
      matchedGoalRef: null,
    });
  });

  test('keeps truly opaque activity neutral without retrying a valid response', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          message: { content: JSON.stringify({ v: 'uncertain', c: null, t: null, m: null }) },
        }),
        { status: 200 }
      )) as unknown as typeof fetch;

    const result = await new OllamaClassificationProvider().classify(goals, categories, activity);
    expect(result).toMatchObject({
      status: 'ollama',
      attemptCount: 1,
      choice: { verdict: 'uncertain', chosenCategoryName: null },
    });
  });

  test('recovers a productive method accidentally emitted as the category', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              v: 'productive',
              c: 'study_notes_or_retrieval',
              t: 'T1',
              m: 'study_notes_or_retrieval',
            }),
          },
        }),
        { status: 200 }
      )) as unknown as typeof fetch;

    const result = await new OllamaClassificationProvider().classify(goals, categories, activity);
    expect(result).toMatchObject({
      status: 'ollama',
      attemptCount: 1,
      choice: {
        chosenCategoryName: 'Work',
        verdict: 'productive',
        goalRelation: 'supporting',
        supportingMode: 'study_notes_or_retrieval',
      },
    });
  });

  test('creates a direct local distraction nudge only in the deferred enrichment request', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = (async (_url: unknown, init: RequestInit | undefined) => {
      const request = JSON.parse(String(init?.body));
      expect(request.options.num_predict).toBe(96);
      expect(request.messages[1].content).toContain('direct interruption notification');
      expect(request.messages[1].content).toContain('Both nudge fields must be non-null');
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              activityLabel: 'Instagram',
              activitySummary: 'Off goal: scrolling social posts.',
              reasoning: 'The visible content does not advance the supplied study goal.',
              nudgeTitle: 'Close Instagram',
              nudgeBody:
                'Scrolling is borrowing time from your exam prep. Close it and open your notes now.',
            }),
          },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await new OllamaClassificationProvider().enrich(
      goals,
      { name: 'Distraction', description: 'Unrelated entertainment', isProductive: false },
      activity
    );
    expect(result).toMatchObject({
      nudgeTitle: 'Close Instagram',
      nudgeBody:
        'Scrolling is borrowing time from your exam prep. Close it and open your notes now.',
    });
  });

  test('derives a bounded local profile from the goal alone', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = (async (_url: unknown, init: RequestInit | undefined) => {
      const request = JSON.parse(String(init?.body));
      expect(request.messages[1].content).toContain('Solve machine learning exercise sheet');
      expect(request.messages[1].content).not.toContain('Firefox');
      expect(request.options.num_predict).toBe(64);
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              subjectCues: ['machine learning', 'exercise problems'],
              supportingModes: ['calculation_or_visualization', 'study_notes_or_retrieval'],
            }),
          },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    await expect(
      new OllamaClassificationProvider().profileGoal('Solve machine learning exercise sheet')
    ).resolves.toMatchObject({
      subjectCues: ['machine learning', 'exercise problems'],
      supportingModes: ['calculation_or_visualization', 'study_notes_or_retrieval'],
    });
  });

  test('interprets visible page evidence without including a goal', async () => {
    globalThis.fetch = (async (_url: unknown, init: RequestInit | undefined) => {
      const request = JSON.parse(String(init?.body));
      expect(request.messages[1].content).toContain('Graphing Calculator');
      expect(request.messages[1].content).not.toContain('Study Gaussian Processes');
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              k: 'problem_solving',
              a: 'Graphing equations',
              q: ['equations'],
              e: 'strong',
            }),
          },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    await expect(
      new OllamaClassificationProvider().describePage(
        { ...activity, title: 'Graphing Calculator', contentSource: 'title' },
        'title',
        2000
      )
    ).resolves.toMatchObject({
      descriptor: { pageKind: 'problem_solving', actionLabel: 'Graphing equations' },
    });
  });

  test('retains a valid low-confidence distraction decision', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              s: 'distracted',
              r: 'none',
              t: null,
              m: null,
              p: 'low',
              c: 'Distraction',
            }),
          },
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
    const result = await new OllamaClassificationProvider().decideRelation(
      goals,
      categories,
      {
        pageKind: 'communication',
        actionLabel: 'Reading inbox',
        topicCues: [],
        evidenceQuality: 'partial',
        source: 'title',
      },
      { ownerName: 'Mail', title: 'Inbox' },
      2000
    );
    expect(result.decision).toMatchObject({
      state: 'distracted',
      relation: 'none',
      confidence: 'low',
    });
  });

  test('makes one grounded semantic decision from goal and original Firefox evidence', async () => {
    globalThis.fetch = (async (_url: unknown, init: RequestInit | undefined) => {
      const request = JSON.parse(String(init?.body));
      expect(request.messages[1].content).toContain('Study Gaussian Processes');
      expect(request.messages[1].content).toContain('Gaussian process regression');
      expect(request.messages[1].content).toContain('"alias":"E4"');
      expect(request.format.required).toEqual(['s', 'r', 't', 'm', 'p', 'c', 'e']);
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              s: 'focused',
              r: 'direct',
              t: 'T1',
              m: null,
              p: 'high',
              c: 'Work',
              e: ['E2', 'E4'],
              l: null,
              g: 'none',
            }),
          },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    const result = await new OllamaClassificationProvider().decideActivity(
      goals,
      categories,
      { ...activity, browser: 'firefox', contentSource: 'dom', siteHost: 'example.test' },
      'balanced',
      2000
    );
    expect(result).toMatchObject({
      attemptCount: 1,
      decision: {
        state: 'focused',
        relation: 'direct',
        matchedGoalRef: 'daily:today:gp',
        evidenceAliases: ['E2', 'E4'],
      },
    });
  });

  test('drops invented evidence aliases and unknown target aliases', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              s: 'focused',
              r: 'direct',
              t: 'T9',
              m: null,
              p: 'high',
              c: 'Work',
              e: ['E9'],
              l: null,
              g: 'none',
            }),
          },
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
    const result = await new OllamaClassificationProvider().decideActivity(
      goals,
      categories,
      { ...activity, browser: 'firefox', contentSource: 'dom' },
      'flexible',
      2000
    );
    expect(result.decision).toMatchObject({ matchedGoalRef: null, evidenceAliases: [] });
  });
});
