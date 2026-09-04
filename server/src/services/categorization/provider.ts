import { z } from 'zod';
import { ActiveWindowDetails, Category as CategoryType } from '../../../../shared/types';
import {
  buildCoreClassificationPromptInput,
  buildEnrichmentPromptInput,
  CoreClassificationDecisionSchema,
  EnrichmentSchema,
  UserGoals,
} from './llm';

export type ClassificationStatus =
  | 'history' | 'navigation_cache' | 'ollama' | 'manual' | 'manual_rule'
  | 'policy_override' | 'ollama_unavailable' | 'invalid_response'
  | 'ocr_unavailable' | 'insufficient_context';

export type ClassificationFailureCode =
  | 'empty_model_output' | 'invalid_json' | 'invalid_decision_shape'
  | 'unknown_category' | 'core_retry_exhausted' | 'timeout'
  | 'ollama_http_error' | 'enrichment_failed';

export type CoreClassificationDecision = z.infer<typeof CoreClassificationDecisionSchema>;
export type ClassificationEnrichment = z.infer<typeof EnrichmentSchema>;
type ActivityContext = Pick<ActiveWindowDetails, 'ownerName' | 'title' | 'url' | 'content' | 'type' | 'browser'>;
type PromptCategory = Pick<CategoryType, 'name' | 'description' | 'isProductive'>;

export interface ClassificationProviderResult {
  choice: CoreClassificationDecision | null;
  status: Exclude<ClassificationStatus, 'history'>;
  failureCode?: ClassificationFailureCode;
  attemptCount: number;
}

export interface ClassificationProvider {
  classify(goals: UserGoals, categories: PromptCategory[], activity: ActivityContext): Promise<ClassificationProviderResult>;
  enrich(goals: UserGoals, category: PromptCategory, activity: ActivityContext, signal?: AbortSignal): Promise<ClassificationEnrichment | null>;
}

function getLoopbackOllamaUrl(): URL {
  const url = new URL(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
  if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) throw new Error('Ollama must use a loopback URL in Cronus Local mode.');
  return url;
}

const coreResponseSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    chosenCategoryName: { type: 'string', maxLength: 64 }, confidence: { type: 'number', minimum: 0, maximum: 1 },
    goalAlignment: { type: 'string', enum: ['explicit', 'none', 'insufficient'] },
    matchedGoalType: { type: ['string', 'null'], enum: ['daily', 'weekly', 'life', 'session', null] },
    goalEvidence: { type: ['string', 'null'], maxLength: 100 },
  },
  required: ['chosenCategoryName', 'confidence', 'goalAlignment', 'matchedGoalType', 'goalEvidence'],
};

const enrichmentResponseSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    activityLabel: { type: 'string', maxLength: 48 }, activitySummary: { type: 'string', maxLength: 80 },
    reasoning: { type: 'string', maxLength: 100 }, nudgeTitle: { type: ['string', 'null'], maxLength: 60 },
    nudgeBody: { type: ['string', 'null'], maxLength: 120 },
  },
  required: ['activityLabel', 'activitySummary', 'reasoning', 'nudgeTitle', 'nudgeBody'],
};

const boundedNumber = (value: string | undefined, fallback: number, minimum: number, maximum: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};

const ollamaConfig = () => ({
  model: process.env.OLLAMA_MODEL || 'qwen3:4b-instruct', keepAlive: process.env.OLLAMA_KEEP_ALIVE || '10m',
  numCtx: boundedNumber(process.env.OLLAMA_NUM_CTX, 4096, 512, 16384), numPredict: boundedNumber(process.env.OLLAMA_NUM_PREDICT, 128, 32, 512),
});

function parseStructuredResponse(raw: string): unknown | null {
  const trimmed = raw.trim();
  for (const candidate of [trimmed, trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()]) {
    try { return JSON.parse(candidate); } catch { /* try the next representation */ }
  }
  return null;
}

function normalizeCoreDecision(value: unknown, categories: PromptCategory[]): { decision: CoreClassificationDecision | null; failure?: ClassificationFailureCode } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { decision: null, failure: 'invalid_decision_shape' };
  const raw = value as Record<string, unknown>;
  const name = typeof raw.chosenCategoryName === 'string' ? raw.chosenCategoryName.trim().replace(/^['"`]+|['"`]+$/g, '') : '';
  const chosenCategoryName = categories.find((category) => category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())?.name;
  if (!chosenCategoryName) return { decision: null, failure: 'unknown_category' };
  const rawConfidence = typeof raw.confidence === 'string' ? Number(raw.confidence.replace('%', '')) : raw.confidence;
  const confidence = typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
    ? rawConfidence > 1 && rawConfidence <= 100 ? rawConfidence / 100 : rawConfidence : Number.NaN;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return { decision: null, failure: 'invalid_decision_shape' };
  const alignment = typeof raw.goalAlignment === 'string' ? raw.goalAlignment.trim().toLowerCase() : '';
  const goalAlignment = alignment === 'explicit' || alignment === 'none' || alignment === 'insufficient' ? alignment : 'insufficient';
  const goalType = raw.matchedGoalType;
  const matchedGoalType = goalType === 'daily' || goalType === 'weekly' || goalType === 'life' || goalType === 'session' ? goalType : null;
  const goalEvidence = typeof raw.goalEvidence === 'string' && raw.goalEvidence.trim() ? raw.goalEvidence.trim().slice(0, 100) : null;
  return { decision: { chosenCategoryName, confidence, goalAlignment, matchedGoalType, goalEvidence } };
}

async function chat(messages: Array<{ role: 'system' | 'user'; content: string }>, format: object, numPredict: number, timeoutMs: number, externalSignal?: AbortSignal): Promise<{ content: string | null; failure?: ClassificationFailureCode }> {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort(); externalSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    const config = ollamaConfig(); const startedAt = performance.now();
    const response = await fetch(new URL('/api/chat', getLoopbackOllamaUrl()), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ model: config.model, stream: false, format, think: false, keep_alive: config.keepAlive, options: { temperature: 0, num_ctx: config.numCtx, num_predict: numPredict }, messages }),
    });
    if (!response.ok) return { content: null, failure: 'ollama_http_error' };
    const payload = await response.json() as { message?: { content?: string }; load_duration?: number; prompt_eval_duration?: number; eval_duration?: number; prompt_eval_count?: number; eval_count?: number };
    console.info('[classification-timing]', JSON.stringify({ phase: 'ollama', totalMs: Math.round(performance.now() - startedAt), loadMs: Math.round((payload.load_duration || 0) / 1_000_000), promptEvalMs: Math.round((payload.prompt_eval_duration || 0) / 1_000_000), evalMs: Math.round((payload.eval_duration || 0) / 1_000_000), promptTokens: payload.prompt_eval_count || 0, outputTokens: payload.eval_count || 0 }));
    return payload.message?.content ? { content: payload.message.content } : { content: null, failure: 'empty_model_output' };
  } catch {
    return { content: null, failure: controller.signal.aborted ? 'timeout' : 'ollama_http_error' };
  } finally { clearTimeout(timeout); externalSignal?.removeEventListener('abort', onAbort); }
}

/** Preloads only the configured local model. Failure is intentionally non-fatal. */
export async function warmLocalClassificationModel(): Promise<void> {
  try {
    const baseUrl = getLoopbackOllamaUrl(); const config = ollamaConfig();
    await fetch(new URL('/api/generate', baseUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.model, prompt: '', stream: false, keep_alive: config.keepAlive }) });
    console.info('[classification-timing]', JSON.stringify({ phase: 'warmup', result: 'requested' }));
  } catch { console.info('[classification-timing]', JSON.stringify({ phase: 'warmup', result: 'unavailable' })); }
}

export class OllamaClassificationProvider implements ClassificationProvider {
  async classify(goals: UserGoals, categories: PromptCategory[], activity: ActivityContext): Promise<ClassificationProviderResult> {
    const startedAt = Date.now(); const totalTimeoutMs = boundedNumber(process.env.OLLAMA_TIMEOUT_MS, 30000, 1000, 60000);
    const resolve = (response: { content: string | null; failure?: ClassificationFailureCode }) => {
      if (!response.content) return { decision: null, failure: response.failure };
      const json = parseStructuredResponse(response.content);
      return json === null ? { decision: null, failure: 'invalid_json' as const } : normalizeCoreDecision(json, categories);
    };
    const first = resolve(await chat(buildCoreClassificationPromptInput(goals, categories, activity), coreResponseSchema, Math.min(64, ollamaConfig().numPredict), Math.min(22000, totalTimeoutMs)));
    if (first.decision) return { choice: first.decision, status: 'ollama', attemptCount: 1 };
    if (first.failure === 'ollama_http_error' || first.failure === 'timeout') return { choice: null, status: 'ollama_unavailable', failureCode: first.failure, attemptCount: 1 };
    const remainingMs = totalTimeoutMs - (Date.now() - startedAt);
    if (remainingMs < 1000) return { choice: null, status: 'invalid_response', failureCode: 'core_retry_exhausted', attemptCount: 1 };
    const retryPrompt = buildCoreClassificationPromptInput(goals, categories, activity).map((message, index) => index === 1 ? { ...message, content: `${message.content}\nRETRY: Return only the five required decision fields. Do not add prose.` } : message);
    const second = resolve(await chat(retryPrompt, coreResponseSchema, Math.min(48, ollamaConfig().numPredict), Math.min(8000, remainingMs)));
    if (second.decision) return { choice: second.decision, status: 'ollama', attemptCount: 2 };
    const failureCode = second.failure === 'ollama_http_error' || second.failure === 'timeout' ? second.failure : 'core_retry_exhausted';
    return { choice: null, status: failureCode === 'ollama_http_error' || failureCode === 'timeout' ? 'ollama_unavailable' : 'invalid_response', failureCode, attemptCount: 2 };
  }

  async enrich(goals: UserGoals, category: PromptCategory, activity: ActivityContext, signal?: AbortSignal): Promise<ClassificationEnrichment | null> {
    const result = await chat(buildEnrichmentPromptInput(goals, activity, category.name, category.isProductive), enrichmentResponseSchema, Math.min(96, ollamaConfig().numPredict), 12000, signal);
    if (!result.content) return null;
    const parsed = EnrichmentSchema.safeParse(parseStructuredResponse(result.content));
    if (!parsed.success) return null;
    const clip = (value: string, limit: number) => value.trim().slice(0, limit).trim();
    return { activityLabel: clip(parsed.data.activityLabel, 48), activitySummary: clip(parsed.data.activitySummary, 80), reasoning: clip(parsed.data.reasoning.split(/\s+/).slice(0, 12).join(' '), 100), nudgeTitle: parsed.data.nudgeTitle ? clip(parsed.data.nudgeTitle, 60) : null, nudgeBody: parsed.data.nudgeBody ? clip(parsed.data.nudgeBody, 120) : null };
  }
}

export const localClassificationProvider = new OllamaClassificationProvider();
