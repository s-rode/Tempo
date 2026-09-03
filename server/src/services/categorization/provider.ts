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
  | 'manual'
  | 'manual_rule'
  | 'policy_override'
  | 'ollama_unavailable'
  | 'invalid_response'
  | 'ocr_unavailable'
  | 'insufficient_context';

export interface ClassificationProvider {
  classify(
    userGoals: UserGoals,
    userCategories: Pick<CategoryType, 'name' | 'description' | 'isProductive'>[],
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
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    goalAlignment: { type: 'string', enum: ['explicit', 'none', 'insufficient'] },
    matchedGoalType: { type: ['string', 'null'], enum: ['daily', 'weekly', 'life', null] },
    goalEvidence: { type: ['string', 'null'], maxLength: 100 },
    activityLabel: { type: 'string', maxLength: 48 },
    activitySummary: { type: 'string', maxLength: 80 },
    reasoning: { type: 'string', maxLength: 100 },
    nudgeTitle: { type: ['string', 'null'], maxLength: 60 },
    nudgeBody: { type: ['string', 'null'], maxLength: 120 },
  },
  required: [
    'chosenCategoryName',
    'confidence',
    'goalAlignment',
    'matchedGoalType',
    'goalEvidence',
    'activityLabel',
    'activitySummary',
    'reasoning',
    'nudgeTitle',
    'nudgeBody',
  ],
};

const boundedNumber = (value: string | undefined, fallback: number, minimum: number, maximum: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};

const ollamaConfig = () => ({
  model: process.env.OLLAMA_MODEL || 'qwen3:4b-instruct',
  keepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
  numCtx: boundedNumber(process.env.OLLAMA_NUM_CTX, 4096, 512, 16384),
  numPredict: boundedNumber(process.env.OLLAMA_NUM_PREDICT, 192, 32, 512),
});

/** Preloads only the configured local model. Failure is intentionally non-fatal. */
export async function warmLocalClassificationModel(): Promise<void> {
  try {
    const baseUrl = getLoopbackOllamaUrl();
    const config = ollamaConfig();
    await fetch(new URL('/api/generate', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, prompt: '', stream: false, keep_alive: config.keepAlive }),
    });
    console.info('[classification-timing]', JSON.stringify({ phase: 'warmup', result: 'requested' }));
  } catch (_error) {
    console.info('[classification-timing]', JSON.stringify({ phase: 'warmup', result: 'unavailable' }));
  }
}

export class OllamaClassificationProvider implements ClassificationProvider {
  async classify(
    userGoals: UserGoals,
    userCategories: Pick<CategoryType, 'name' | 'description' | 'isProductive'>[],
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
      const config = ollamaConfig();
      const startedAt = performance.now();
      const response = await fetch(new URL('/api/chat', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model,
          stream: false,
          format: responseSchema,
          think: false,
          keep_alive: config.keepAlive,
          options: { temperature: 0, num_ctx: config.numCtx, num_predict: config.numPredict },
          messages: prompt,
        }),
      });

      if (!response.ok) {
        console.error(`Ollama classification failed: ${response.status} ${response.statusText}`);
        return { choice: null, status: 'ollama_unavailable' };
      }

      const payload = (await response.json()) as {
        message?: { content?: string };
        load_duration?: number;
        prompt_eval_duration?: number;
        eval_duration?: number;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      console.info('[classification-timing]', JSON.stringify({
        phase: 'ollama',
        totalMs: Math.round(performance.now() - startedAt),
        loadMs: Math.round((payload.load_duration || 0) / 1_000_000),
        promptEvalMs: Math.round((payload.prompt_eval_duration || 0) / 1_000_000),
        evalMs: Math.round((payload.eval_duration || 0) / 1_000_000),
        promptTokens: payload.prompt_eval_count || 0,
        outputTokens: payload.eval_count || 0,
      }));
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
      const clip = (value: string, limit: number): string => value.trim().slice(0, limit).trim();
      const reasoning = clip(parsed.data.reasoning.split(/\s+/).slice(0, 12).join(' '), 100);
      return {
        choice: {
          ...parsed.data,
          activityLabel: clip(parsed.data.activityLabel, 48),
          activitySummary: clip(parsed.data.activitySummary, 80),
          reasoning,
          goalEvidence: parsed.data.goalEvidence ? clip(parsed.data.goalEvidence.split(/\s+/).slice(0, 12).join(' '), 100) : null,
          nudgeTitle: parsed.data.nudgeTitle ? clip(parsed.data.nudgeTitle, 60) : null,
          nudgeBody: parsed.data.nudgeBody ? clip(parsed.data.nudgeBody, 120) : null,
        },
        status: 'ollama',
      };
    } catch (error) {
      console.error('Ollama classification is unavailable or invalid:', error);
      return { choice: null, status: 'ollama_unavailable' };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const localClassificationProvider = new OllamaClassificationProvider();
