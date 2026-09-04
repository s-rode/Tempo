import { afterEach, describe, expect, test } from 'bun:test';
import { OllamaClassificationProvider } from './provider';

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.OLLAMA_BASE_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = originalBaseUrl;
});

const goals = { dailyGoal: 'Study Gaussian Processes', weeklyGoal: '', lifeGoal: '' };
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
  test('uses bounded local structured output without thinking', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = (async (_url: unknown, init: RequestInit | undefined) => {
      const request = JSON.parse(String(init?.body));
      expect(request.stream).toBe(false);
      expect(request.think).toBe(false);
      expect(request.keep_alive).toBe('10m');
      expect(request.options.temperature).toBe(0);
      expect(request.options.num_ctx).toBe(4096);
      expect(request.options.num_predict).toBe(64);
      expect(request.format.required).toEqual([
        'chosenCategoryName',
        'confidence',
        'goalAlignment',
        'matchedGoalType',
        'goalEvidence'
      ]);
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              chosenCategoryName: 'Work',
              confidence: 0.9,
              goalAlignment: 'explicit',
              matchedGoalType: 'daily',
              goalEvidence: 'The tutorial directly supports the daily Gaussian Processes goal.',
              activityLabel: 'Gaussian Process tutorial',
              activitySummary: 'Studying Gaussian Process regression.',
              reasoning: 'a a a a a a a a a a a a a a a a a a a a a a a a a a',
              nudgeTitle: null,
              nudgeBody: null
            }),
          },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await new OllamaClassificationProvider().classify(goals, categories, activity);
    expect(result.status).toBe('ollama');
    expect(result.choice?.chosenCategoryName).toBe('Work');
    expect(result.attemptCount).toBe(1);
  });

  test('rejects non-loopback Ollama URLs', async () => {
    process.env.OLLAMA_BASE_URL = 'https://example.com';
    const result = await new OllamaClassificationProvider().classify(goals, categories, activity);
    expect(result).toMatchObject({ choice: null, status: 'ollama_unavailable', attemptCount: 1 });
  });

  test('accepts a minimal valid decision', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = (async () => new Response(
      JSON.stringify({
        message: {
          content: JSON.stringify({
            chosenCategoryName: 'Distraction',
            confidence: '0.82',
            goalAlignment: 'none',
            matchedGoalType: null,
            goalEvidence: null,
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
      matchedGoalType: null,
    });
  });

  test('accepts a JSON response wrapped in a markdown fence', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = (async () => new Response(
      JSON.stringify({
        message: {
          content: '```json\n{"chosenCategoryName":"Work","confidence":0.9,"goalAlignment":"explicit","matchedGoalType":"daily","goalEvidence":"Directly supports the stated study goal."}\n```',
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
      return new Response(JSON.stringify({ message: { content: calls === 1 ? '{bad' : JSON.stringify({ chosenCategoryName: 'Work', confidence: 0.9, goalAlignment: 'explicit', matchedGoalType: 'daily', goalEvidence: 'Directly supports the stated study goal.' }) } }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await new OllamaClassificationProvider().classify(goals, categories, activity);
    expect(calls).toBe(2);
    expect(result).toMatchObject({ status: 'ollama', attemptCount: 2, choice: { chosenCategoryName: 'Work' } });
  });
});
