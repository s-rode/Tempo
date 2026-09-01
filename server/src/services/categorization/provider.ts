import { z } from 'zod';
import { ActiveWindowDetails, Category as CategoryType } from '../../../../shared/types';
import {
  buildCategoryChoicePromptInput,
  CategoryChoiceSchema,
  UserGoals,
} from './llm';

export type ClassificationStatus =
  | 'history'
  | 'ollama'
  | 'ollama_unavailable'
  | 'invalid_response';

export interface ClassificationProvider {
  classify(
    userGoals: UserGoals,
    userCategories: Pick<CategoryType, 'name' | 'description'>[],
    activityDetails: Pick<
      ActiveWindowDetails,
      'ownerName' | 'title' | 'url' | 'content' | 'type' | 'browser'
    >
  ): Promise<ClassificationProviderResult>;
}

export interface ClassificationProviderResult {
  choice: z.infer<typeof CategoryChoiceSchema> | null;
  status: Exclude<ClassificationStatus, 'history'>;
}

function getLoopbackOllamaUrl(): URL {
  const configured = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const url = new URL(configured);
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!loopbackHosts.has(url.hostname)) {
    throw new Error('Ollama must use a loopback URL in Cronus Local mode.');
  }
  return url;
}

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chosenCategoryName: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['chosenCategoryName', 'reasoning'],
};

export class OllamaClassificationProvider implements ClassificationProvider {
  async classify(
    userGoals: UserGoals,
    userCategories: Pick<CategoryType, 'name' | 'description'>[],
    activityDetails: Pick<
      ActiveWindowDetails,
      'ownerName' | 'title' | 'url' | 'content' | 'type' | 'browser'
    >
  ): Promise<ClassificationProviderResult> {
    const prompt = buildCategoryChoicePromptInput(userGoals, userCategories, activityDetails);
    const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || '30000');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const baseUrl = getLoopbackOllamaUrl();
      const response = await fetch(new URL('/api/chat', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: process.env.OLLAMA_MODEL || 'qwen3:4b-instruct',
          stream: false,
          format: responseSchema,
          options: { temperature: 0 },
          messages: prompt,
        }),
      });

      if (!response.ok) {
        console.error(`Ollama classification failed: ${response.status} ${response.statusText}`);
        return { choice: null, status: 'ollama_unavailable' };
      }

      const payload = (await response.json()) as { message?: { content?: string } };
      const rawContent = payload.message?.content;
      if (!rawContent) {
        console.error('Ollama classification returned no message content.');
        return { choice: null, status: 'invalid_response' };
      }

      let json: unknown;
      try {
        json = JSON.parse(rawContent);
      } catch (error) {
        console.error('Ollama classification returned invalid JSON:', error);
        return { choice: null, status: 'invalid_response' };
      }
      const parsed = CategoryChoiceSchema.safeParse(json);
      if (!parsed.success) {
        console.error('Ollama classification response failed schema validation:', parsed.error);
        return { choice: null, status: 'invalid_response' };
      }
      const reasoning = parsed.data.reasoning.trim().split(/\s+/).slice(0, 20).join(' ');
      return { choice: { ...parsed.data, reasoning }, status: 'ollama' };
    } catch (error) {
      console.error('Ollama classification is unavailable or invalid:', error);
      return { choice: null, status: 'ollama_unavailable' };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const localClassificationProvider = new OllamaClassificationProvider();
