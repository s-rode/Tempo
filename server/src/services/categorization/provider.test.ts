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
  { name: 'Work', description: 'Goal-related study' },
  { name: 'Distraction', description: 'Unrelated entertainment' },
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
  test('uses local structured output and trims reasoning to twenty words', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = (async (_url: unknown, init: RequestInit | undefined) => {
      const request = JSON.parse(String(init?.body));
      expect(request.stream).toBe(false);
      expect(request.options.temperature).toBe(0);
      expect(request.format.required).toEqual(['chosenCategoryName', 'reasoning']);
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              chosenCategoryName: 'Work',
              reasoning: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one',
            }),
          },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await new OllamaClassificationProvider().classify(goals, categories, activity);
    expect(result.status).toBe('ollama');
    expect(result.choice?.chosenCategoryName).toBe('Work');
    expect(result.choice?.reasoning.split(/\s+/)).toHaveLength(20);
  });

  test('rejects non-loopback Ollama URLs', async () => {
    process.env.OLLAMA_BASE_URL = 'https://example.com';
    const result = await new OllamaClassificationProvider().classify(goals, categories, activity);
    expect(result).toEqual({ choice: null, status: 'ollama_unavailable' });
  });
});
