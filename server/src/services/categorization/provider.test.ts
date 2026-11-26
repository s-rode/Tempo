import { afterEach, describe, expect, test } from 'bun:test';
import { buildCoreClassificationPromptInput } from './llm';
import { OllamaClassificationProvider, clearClassificationDecisionCaches } from './provider';
import { DecisionCache } from './decisionCache';
import type { EffectiveGoalContext } from '../goalPlans';

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.OLLAMA_BASE_URL;

afterEach(() => {
  clearClassificationDecisionCaches();
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
      expect(request.keep_alive).toBe('5m');
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
    }) as unknown as unknown as typeof fetch;

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
      )) as unknown as unknown as typeof fetch;

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
      )) as unknown as unknown as typeof fetch;

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
      )) as unknown as unknown as typeof fetch;

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
    }) as unknown as unknown as typeof fetch;
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
      )) as unknown as unknown as typeof fetch;

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
      )) as unknown as unknown as typeof fetch;

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
      )) as unknown as unknown as typeof fetch;

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

  test('background enrichment only describes activity and leaves notification generation on demand', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = (async (_url: unknown, init: RequestInit | undefined) => {
      const request = JSON.parse(String(init?.body));
      expect(request.options.num_predict).toBe(96);
      expect(request.format.required).toEqual(['activityLabel', 'activitySummary', 'reasoning']);
      expect(request.messages[1].content).toContain('no notification copy');
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
    }) as unknown as unknown as typeof fetch;

    const result = await new OllamaClassificationProvider().enrich(
      goals,
      { name: 'Distraction', description: 'Unrelated entertainment', isProductive: false },
      activity
    );
    expect(result).toMatchObject({ nudgeTitle: null, nudgeBody: null });
  });

  test('creates notification-only copy with a bounded request and no page-content input', async () => {
    globalThis.fetch = (async (_url: unknown, init: RequestInit | undefined) => {
      const request = JSON.parse(String(init?.body));
      expect(request.options.num_predict).toBe(112);
      expect(request.think).toBe(false);
      expect(Object.keys(request.format.properties)).toEqual(['distraction', 'title', 'body']);
      expect(JSON.parse(request.messages[1].content)).toEqual({
        application: 'WhatsApp',
        windowTitle: 'WhatsApp',
        goal: 'Solve the statistics exercise sheet',
      });
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              distraction: 'chatting',
              title: 'Put the chat aside',
              body: 'Leave the messages for later and solve the next statistics exercise.',
            }),
          },
        })
      );
    }) as typeof fetch;
    expect(
      await new OllamaClassificationProvider().distractionNudge(
        'Solve the statistics exercise sheet',
        { ownerName: 'WhatsApp', title: 'WhatsApp' }
      )
    ).toEqual({
      title: 'Put the chat aside',
      body: 'Leave the messages for later and solve the next statistics exercise.',
    });
  });

  test('does not start an already-cancelled notification request', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error('must not run');
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    controller.abort();
    expect(
      await new OllamaClassificationProvider().distractionNudge(
        'Study',
        { ownerName: 'Chat', title: 'Chat' },
        controller.signal
      )
    ).toBeNull();
    expect(calls).toBe(0);
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
    }) as unknown as unknown as typeof fetch;

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
    }) as unknown as unknown as typeof fetch;
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
      )) as unknown as unknown as typeof fetch;
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
    }) as unknown as unknown as typeof fetch;
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
      )) as unknown as unknown as typeof fetch;
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

describe('personalized semantic wire contract', () => {
  test('uses one verdict after subject extraction and preserves a concrete low-confidence distraction', async () => {
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(request.format.required).toEqual(['o', 'k', 'u', 'q', 'v', 't', 'm', 'p', 'e']);
      expect(request.format.properties.m.enum).not.toContain('resource_navigation');
      expect(request.options.num_predict).toBeLessThanOrEqual(128);
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              o: 'Physics',
              q: 'Algorithms',
              v: 'distracting',
              t: 'T1',
              m: null,
              p: 'low',
              e: ['E2'],
            }),
          },
        })
      );
    }) as unknown as typeof fetch;
    const result = await new OllamaClassificationProvider().decideActivity(
      goals,
      categories,
      { ...activity, title: 'Physics lecture' },
      'balanced',
      10000,
      [],
      true
    );
    expect(result.decision?.assessment).toBe('conflicting');
    expect(result.decision?.state).toBe('distracted');
    expect(result.decision?.confidence).toBe('low');
  });
  const personalized = async (
    reply: Record<string, unknown>,
    overrides: Partial<typeof activity> = {}
  ) => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              q: 'Algorithms',
              t: 'T1',
              m: null,
              p: 'high',
              e: ['E2'],
              ...reply,
            }),
          },
        })
      )) as unknown as typeof fetch;
    return (
      await new OllamaClassificationProvider().decideActivity(
        goals,
        categories,
        { ...activity, ...overrides },
        'balanced',
        10000,
        [],
        true
      )
    ).decision;
  };
  test('a window the model reports as having no subject is opaque whatever its verdict', async () => {
    for (const v of ['productive', 'distracting']) {
      const decision = await personalized(
        { o: 'Untitled-1', k: 'no_subject', v },
        { title: 'Untitled-1' }
      );
      expect(decision?.state).toBe('uncertain');
      expect(decision?.assessment).toBe('opaque');
    }
  });
  test('no subject stays opaque unless the model says the app cannot serve the task', async () => {
    for (const u of ['yes', 'maybe']) {
      clearClassificationDecisionCaches();
      const decision = await personalized(
        { o: 'All Inboxes', k: 'no_subject', u, v: 'distracting' },
        { ownerName: 'Mail', title: 'All Inboxes' }
      );
      expect(decision?.state).toBe('uncertain');
      expect(decision?.taskFit).toBe(u as 'yes' | 'maybe');
    }
    clearClassificationDecisionCaches();
    const unrelated = await personalized(
      { o: 'All Inboxes', k: 'no_subject', u: 'no', v: 'distracting', e: ['E1'] },
      { ownerName: 'Mail', title: 'All Inboxes' }
    );
    expect(unrelated?.state).toBe('distracted');
    expect(unrelated?.assessment).toBe('conflicting');
    expect(unrelated?.visibleKind).toBe('no_subject');
    expect(unrelated?.taskFit).toBe('no');
    // An unfit app is no reason to call the window productive.
    clearClassificationDecisionCaches();
    const productive = await personalized(
      { o: 'All Inboxes', k: 'no_subject', u: 'no', v: 'productive' },
      { ownerName: 'Mail', title: 'All Inboxes' }
    );
    expect(productive?.state).toBe('uncertain');
  });
  test('an unfit app does not bypass the file-name check', async () => {
    const decision = await personalized(
      { o: 'CarMarket', k: 'named_subject', u: 'no', v: 'distracting' },
      {
        ownerName: 'Code',
        type: 'window' as any,
        browser: null as any,
        title: 'CarMarket.ipynb — notebooks',
      }
    );
    expect(decision?.state).toBe('uncertain');
  });
  test('a productive verdict needs a subject that occurs in the visible evidence', async () => {
    const copiedFromTask = await personalized(
      { o: 'Algorithms lecture', k: 'named_subject', v: 'productive' },
      { title: 'Celebrity news' }
    );
    expect(copiedFromTask?.state).toBe('uncertain');
    expect(copiedFromTask?.assessment).toBe('opaque');
    const visible = await personalized(
      { o: 'Dijkstra shortest paths', k: 'named_subject', v: 'productive' },
      { title: 'Lecture 9: Dijkstra and shortest paths.pdf' }
    );
    expect(visible?.state).toBe('focused');
    expect(visible?.assessment).toBe('relevant');
  });
  test('a bare file name in a native app is never the sole basis for a distraction', async () => {
    const reply = { o: 'CarMarket', k: 'named_subject', v: 'distracting' };
    const notebook = await personalized(reply, {
      ownerName: 'Code',
      type: 'window' as any,
      browser: null as any,
      title: 'Practice2_CarMarket.ipynb — interview-notebooks',
    });
    expect(notebook?.state).toBe('uncertain');
    expect(notebook?.assessment).toBe('opaque');
    const described = await personalized(
      { ...reply, o: 'Organic chemistry' },
      {
        ownerName: 'RemNote',
        title: 'Organic chemistry reaction mechanisms',
        type: 'window' as any,
        browser: null as any,
      }
    );
    expect(described?.state).toBe('distracted');
    const leisure = await personalized(
      { ...reply, k: 'leisure' },
      { ownerName: 'VLC', title: 'holiday_movie.mp4', type: 'window' as any, browser: null as any }
    );
    expect(leisure?.state).toBe('distracted');
  });
  test('grounding never weakens a distracting verdict', async () => {
    const decision = await personalized(
      { o: 'entertainment', k: 'leisure', v: 'distracting' },
      { title: 'Top 50 funniest cat videos' }
    );
    expect(decision?.state).toBe('distracted');
  });
  test('rejects a duplicate-title alias that was never independent evidence in the prompt', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              o: null,
              q: 'Study',
              v: 'uncertain',
              t: 'T1',
              m: null,
              p: 'medium',
              e: ['E1', 'E2'],
            }),
          },
        })
      )) as unknown as typeof fetch;
    const result = await new OllamaClassificationProvider().decideActivity(
      goals,
      categories,
      { ...activity, ownerName: 'Tutor', title: 'Tutor' },
      'balanced',
      10000,
      [],
      true
    );
    expect(result.decision?.evidenceAliases).toEqual(['E1']);
  });
});

describe('model decision memoization', () => {
  const personalizedReply = (verdict: string) =>
    new Response(
      JSON.stringify({
        message: {
          content: JSON.stringify({
            o: null,
            q: 'Study',
            v: verdict,
            t: 'T1',
            m: null,
            p: 'high',
            e: ['E2'],
          }),
        },
      })
    );
  const decide = (
    provider: OllamaClassificationProvider,
    overrides: Partial<typeof activity> = {},
    targetGoals: EffectiveGoalContext = goals
  ) =>
    provider.decideActivity(
      targetGoals,
      categories,
      { ...activity, ...overrides },
      'balanced',
      10000,
      [],
      true
    );

  test('reuses a decision for an identical request without calling the model again', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return personalizedReply('productive');
    }) as unknown as typeof fetch;
    const provider = new OllamaClassificationProvider();
    const first = await decide(provider);
    const second = await decide(provider);
    expect(calls).toBe(1);
    expect(first.attemptCount).toBe(1);
    expect(second.attemptCount).toBe(0);
    expect(second.decision).toEqual(first.decision);
  });

  test('a changed title, goal text or target ref is a cache miss', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return personalizedReply('productive');
    }) as unknown as typeof fetch;
    const provider = new OllamaClassificationProvider();
    await decide(provider);
    await decide(provider, { title: 'A different tutorial' });
    await decide(
      provider,
      {},
      { ...goals, targets: [{ ...goals.targets![0], text: 'Other task' }] }
    );
    await decide(
      provider,
      {},
      { ...goals, targets: [{ ...goals.targets![0], ref: 'daily:today:other' }] }
    );
    expect(calls).toBe(4);
  });

  test('does not cache failures or invalid model output', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ message: { content: 'not json' } }));
    }) as unknown as typeof fetch;
    const provider = new OllamaClassificationProvider();
    expect((await decide(provider)).decision).toBeNull();
    const callsAfterFirst = calls;
    expect((await decide(provider)).decision).toBeNull();
    expect(calls).toBe(callsAfterFirst * 2);
  });

  test('returns an independent copy so a caller cannot corrupt the cached decision', async () => {
    globalThis.fetch = (async () => personalizedReply('productive')) as unknown as typeof fetch;
    const provider = new OllamaClassificationProvider();
    await decide(provider);
    const hit = await decide(provider);
    hit.decision!.evidenceAliases.push('E9');
    expect((await decide(provider)).decision!.evidenceAliases).not.toContain('E9');
  });
});

describe('DecisionCache', () => {
  test('expires entries after the TTL', () => {
    let now = 1_000;
    const cache = new DecisionCache<number>(8, 100, () => now);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    now += 101;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  test('evicts the least recently used entry beyond its capacity', () => {
    const cache = new DecisionCache<number>(2, 1_000, () => 0);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1); // refresh a, so b is now the oldest
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  test('keys are stable hashes that do not contain the input text', () => {
    const key = DecisionCache.keyFor({ title: 'Secret page title' });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(DecisionCache.keyFor({ title: 'Secret page title' }));
    expect(key).not.toContain('Secret');
  });
});

describe('foreground decision gate', () => {
  const reply = () =>
    new Response(
      JSON.stringify({
        message: {
          content: JSON.stringify({
            o: 'Gaussian process',
            k: 'named_subject',
            q: 'Gaussian processes',
            v: 'productive',
            t: 'T1',
            m: null,
            p: 'high',
            e: ['E2'],
          }),
        },
      })
    );
  // Resolves after `delayMs` unless the request is aborted first, like Ollama.
  const slowFetch = (delayMs: number, calls: { count: number }) =>
    ((_url: unknown, init?: RequestInit) => {
      calls.count += 1;
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(reply()), delayMs);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    }) as unknown as typeof fetch;
  const decide = (provider: OllamaClassificationProvider, overrides: Partial<typeof activity>) =>
    provider.decideActivity(
      goals,
      categories,
      { ...activity, ...overrides },
      'balanced',
      10000,
      [],
      true
    );

  test('a second capture of the same window joins the running request', async () => {
    const calls = { count: 0 };
    globalThis.fetch = slowFetch(40, calls);
    const provider = new OllamaClassificationProvider();
    const [first, second] = await Promise.all([
      decide(provider, { content: 'Gaussian process regression, first capture' }),
      decide(provider, { content: 'Gaussian process regression, text changed slightly' }),
    ]);
    expect(calls.count).toBe(1);
    expect(first.decision?.state).toBe('focused');
    expect(second.decision).toEqual(first.decision);
    expect(second.attemptCount).toBe(0);
  });

  test('a different window cancels the running request instead of queueing behind it', async () => {
    const calls = { count: 0 };
    globalThis.fetch = slowFetch(40, calls);
    const provider = new OllamaClassificationProvider();
    const left = decide(provider, { title: 'Gaussian process lecture one' });
    const current = decide(provider, { title: 'Gaussian process lecture two' });
    const [leftResult, currentResult] = await Promise.all([left, current]);
    expect(leftResult.decision).toBeNull();
    expect(leftResult.failureCode).toBe('superseded');
    expect(currentResult.decision?.state).toBe('focused');
    expect(calls.count).toBe(2);
  });

  test('a superseded request is not retried and the gate is released afterwards', async () => {
    const calls = { count: 0 };
    globalThis.fetch = slowFetch(20, calls);
    const provider = new OllamaClassificationProvider();
    const left = decide(provider, { title: 'Gaussian process notes A' });
    await decide(provider, { title: 'Gaussian process notes B' });
    expect((await left).attemptCount).toBe(1);
    const later = await decide(provider, { title: 'Gaussian process notes C' });
    expect(later.decision?.state).toBe('focused');
    expect(calls.count).toBe(3);
  });
});
