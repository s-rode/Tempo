import { z } from 'zod';
import { ActiveWindowDetails, Category as CategoryType } from '../../../../shared/types';
import {
  buildCoreClassificationPromptInput,
  buildEnrichmentPromptInput,
  buildGoalSupportProfilePromptInput,
  CoreClassificationDecisionSchema,
  EnrichmentSchema,
  EffectiveGoalContext,
  GoalSupportProfileSchema,
} from './llm';
import { GoalSupportProfileData, isSupportingMode } from './goalSupportTypes';

export type ClassificationStatus =
  | 'history'
  | 'navigation_cache'
  | 'deterministic_direct'
  | 'ollama'
  | 'manual'
  | 'manual_rule'
  | 'policy_override'
  | 'ollama_unavailable'
  | 'invalid_response'
  | 'ocr_unavailable'
  | 'insufficient_context';

export type ClassificationFailureCode =
  | 'empty_model_output'
  | 'invalid_json'
  | 'invalid_decision_shape'
  | 'unknown_category'
  | 'core_retry_exhausted'
  | 'timeout'
  | 'ollama_http_error'
  | 'enrichment_failed';

export type CoreClassificationDecision = z.infer<typeof CoreClassificationDecisionSchema>;
export type ClassificationEnrichment = z.infer<typeof EnrichmentSchema>;
type ActivityContext = Pick<
  ActiveWindowDetails,
  'ownerName' | 'title' | 'url' | 'content' | 'type' | 'browser'
>;
type PromptCategory = Pick<CategoryType, 'name' | 'description' | 'isProductive'>;

export interface ClassificationProviderResult {
  choice: CoreClassificationDecision | null;
  status: Exclude<ClassificationStatus, 'history'>;
  failureCode?: ClassificationFailureCode;
  attemptCount: number;
}

export interface ClassificationProvider {
  classify(
    goals: EffectiveGoalContext,
    categories: PromptCategory[],
    activity: ActivityContext
  ): Promise<ClassificationProviderResult>;
  enrich(
    goals: EffectiveGoalContext,
    category: PromptCategory,
    activity: ActivityContext,
    signal?: AbortSignal
  ): Promise<ClassificationEnrichment | null>;
  profileGoal(goal: string, signal?: AbortSignal): Promise<GoalSupportProfileData | null>;
}

function getLoopbackOllamaUrl(): URL {
  const url = new URL(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
  if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname))
    throw new Error('Ollama must use a loopback URL in Tempo Local mode.');
  return url;
}

const coreResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    // Keep the wire protocol deliberately tiny. The public TypeScript
    // decision remains descriptive below; aliases only exist between Tempo
    // and its local model so a small model cannot run out of output while
    // reproducing a long internal target reference.
    c: { type: 'string', maxLength: 64 },
    p: { type: 'number', minimum: 0, maximum: 1 },
    r: { type: 'string', enum: ['direct', 'supporting', 'none', 'insufficient'] },
    t: { type: ['string', 'null'], maxLength: 4 },
    m: {
      type: ['string', 'null'],
      enum: [
        'calculation_or_visualization',
        'study_notes_or_retrieval',
        'read_reference',
        'coding_or_analysis',
        'drafting_or_problem_solving',
        null,
      ],
    },
    g: { type: ['string', 'null'], maxLength: 60 },
    a: { type: ['string', 'null'], maxLength: 60 },
  },
  required: ['c', 'p', 'r', 't', 'm', 'g', 'a'],
};

const goalSupportProfileResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subjectCues: { type: 'array', items: { type: 'string', maxLength: 32 }, maxItems: 6 },
    supportingModes: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'calculation_or_visualization',
          'study_notes_or_retrieval',
          'read_reference',
          'coding_or_analysis',
          'drafting_or_problem_solving',
        ],
      },
      maxItems: 5,
    },
  },
  required: ['subjectCues', 'supportingModes'],
};

const enrichmentResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    activityLabel: { type: 'string', maxLength: 48 },
    activitySummary: { type: 'string', maxLength: 80 },
    reasoning: { type: 'string', maxLength: 100 },
    nudgeTitle: { type: ['string', 'null'], maxLength: 60 },
    nudgeBody: { type: ['string', 'null'], maxLength: 120 },
  },
  required: ['activityLabel', 'activitySummary', 'reasoning', 'nudgeTitle', 'nudgeBody'],
};

const boundedNumber = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};

const ollamaConfig = () => ({
  model: process.env.OLLAMA_MODEL || 'qwen3:4b-instruct',
  keepAlive: process.env.OLLAMA_KEEP_ALIVE || '10m',
  numCtx: boundedNumber(process.env.OLLAMA_NUM_CTX, 4096, 512, 16384),
  numPredict: boundedNumber(process.env.OLLAMA_NUM_PREDICT, 128, 32, 512),
});

function parseStructuredResponse(raw: string): unknown | null {
  const trimmed = raw.trim();
  for (const candidate of [
    trimmed,
    trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim(),
  ]) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the next representation */
    }
  }
  return null;
}

function normalizeCoreDecision(
  value: unknown,
  categories: PromptCategory[],
  goals: EffectiveGoalContext
): { decision: CoreClassificationDecision | null; failure?: ClassificationFailureCode } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { decision: null, failure: 'invalid_decision_shape' };
  const raw = value as Record<string, unknown>;
  // Accept the former verbose shape too. It lets a locally running model
  // finish an in-flight request during an app upgrade, but all new requests
  // receive the compact schema above.
  const name =
    typeof (raw.c ?? raw.chosenCategoryName) === 'string'
      ? String(raw.c ?? raw.chosenCategoryName)
          .trim()
          .replace(/^['"`]+|['"`]+$/g, '')
      : '';
  const chosenCategoryName = categories.find(
    (category) => category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
  )?.name;
  if (!chosenCategoryName) return { decision: null, failure: 'unknown_category' };
  const rawConfidenceValue = raw.p ?? raw.confidence;
  const rawConfidence =
    typeof rawConfidenceValue === 'string'
      ? Number(rawConfidenceValue.replace('%', ''))
      : rawConfidenceValue;
  const confidence =
    typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
      ? rawConfidence > 1 && rawConfidence <= 100
        ? rawConfidence / 100
        : rawConfidence
      : Number.NaN;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    return { decision: null, failure: 'invalid_decision_shape' };
  const rawRelationValue = raw.r ?? raw.goalRelation;
  const rawRelation =
    typeof rawRelationValue === 'string' ? rawRelationValue.trim().toLowerCase() : '';
  const goalRelation =
    rawRelation === 'direct' ||
    rawRelation === 'supporting' ||
    rawRelation === 'none' ||
    rawRelation === 'insufficient'
      ? rawRelation
      : 'insufficient';
  const rawGoalRefValue = raw.t ?? raw.matchedGoalRef;
  const rawGoalRef =
    typeof rawGoalRefValue === 'string'
      ? rawGoalRefValue.trim().replace(/^['"`]+|['"`]+$/g, '')
      : null;
  const goalRefsByAlias = new Map(
    (goals.targets || []).map((target, index) => [`T${index + 1}`, target.ref])
  );
  const matchedGoalRef =
    rawGoalRef &&
    (goalRefsByAlias.get(rawGoalRef.toUpperCase()) ||
      (goals.targets || []).find((target) => target.ref === rawGoalRef)?.ref)
      ? goalRefsByAlias.get(rawGoalRef.toUpperCase()) ||
        (goals.targets || []).find((target) => target.ref === rawGoalRef)?.ref ||
        null
      : null;
  const rawSupportingMode = raw.m ?? raw.supportingMode;
  const supportingMode = isSupportingMode(rawSupportingMode) ? rawSupportingMode : null;
  const rawGoalEvidence = raw.g ?? raw.goalEvidence;
  const goalEvidence =
    typeof rawGoalEvidence === 'string' && rawGoalEvidence.trim()
      ? rawGoalEvidence.trim().slice(0, 100)
      : null;
  const rawActivityEvidence = raw.a ?? raw.activityEvidence;
  const activityEvidence =
    typeof rawActivityEvidence === 'string' && rawActivityEvidence.trim()
      ? rawActivityEvidence.trim().slice(0, 100)
      : null;
  if (
    (goalRelation === 'direct' || goalRelation === 'supporting') &&
    (!matchedGoalRef || !goalEvidence || !activityEvidence)
  )
    return { decision: null, failure: 'invalid_decision_shape' };
  if (
    (goalRelation === 'none' || goalRelation === 'insufficient') &&
    (matchedGoalRef || supportingMode)
  )
    return { decision: null, failure: 'invalid_decision_shape' };
  if (goalRelation === 'supporting' && !supportingMode)
    return { decision: null, failure: 'invalid_decision_shape' };
  if (goalRelation === 'direct' && supportingMode)
    return { decision: null, failure: 'invalid_decision_shape' };
  return {
    decision: {
      chosenCategoryName,
      confidence,
      goalRelation,
      matchedGoalRef,
      supportingMode,
      goalEvidence,
      activityEvidence,
    },
  };
}

async function chat(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  format: object,
  numPredict: number,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<{ content: string | null; failure?: ClassificationFailureCode }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    const config = ollamaConfig();
    const startedAt = performance.now();
    const response = await fetch(new URL('/api/chat', getLoopbackOllamaUrl()), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        stream: false,
        format,
        think: false,
        keep_alive: config.keepAlive,
        options: { temperature: 0, num_ctx: config.numCtx, num_predict: numPredict },
        messages,
      }),
    });
    if (!response.ok) return { content: null, failure: 'ollama_http_error' };
    const payload = (await response.json()) as {
      message?: { content?: string };
      load_duration?: number;
      prompt_eval_duration?: number;
      eval_duration?: number;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    console.info(
      '[classification-timing]',
      JSON.stringify({
        phase: 'ollama',
        totalMs: Math.round(performance.now() - startedAt),
        loadMs: Math.round((payload.load_duration || 0) / 1_000_000),
        promptEvalMs: Math.round((payload.prompt_eval_duration || 0) / 1_000_000),
        evalMs: Math.round((payload.eval_duration || 0) / 1_000_000),
        promptTokens: payload.prompt_eval_count || 0,
        outputTokens: payload.eval_count || 0,
      })
    );
    return payload.message?.content
      ? { content: payload.message.content }
      : { content: null, failure: 'empty_model_output' };
  } catch {
    return { content: null, failure: controller.signal.aborted ? 'timeout' : 'ollama_http_error' };
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

/** Preloads only the configured local model. Failure is intentionally non-fatal. */
export async function warmLocalClassificationModel(): Promise<void> {
  try {
    const baseUrl = getLoopbackOllamaUrl();
    const config = ollamaConfig();
    await fetch(new URL('/api/generate', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt: '',
        stream: false,
        keep_alive: config.keepAlive,
      }),
    });
    console.info(
      '[classification-timing]',
      JSON.stringify({ phase: 'warmup', result: 'requested' })
    );
  } catch {
    console.info(
      '[classification-timing]',
      JSON.stringify({ phase: 'warmup', result: 'unavailable' })
    );
  }
}

export class OllamaClassificationProvider implements ClassificationProvider {
  async classify(
    goals: EffectiveGoalContext,
    categories: PromptCategory[],
    activity: ActivityContext
  ): Promise<ClassificationProviderResult> {
    const startedAt = Date.now();
    const totalTimeoutMs = boundedNumber(process.env.OLLAMA_TIMEOUT_MS, 30000, 1000, 60000);
    const resolve = (response: { content: string | null; failure?: ClassificationFailureCode }) => {
      if (!response.content) return { decision: null, failure: response.failure };
      const json = parseStructuredResponse(response.content);
      return json === null
        ? { decision: null, failure: 'invalid_json' as const }
        : normalizeCoreDecision(json, categories, goals);
    };
    const first = resolve(
      await chat(
        buildCoreClassificationPromptInput(goals, categories, activity),
        coreResponseSchema,
        Math.min(96, ollamaConfig().numPredict),
        Math.min(22000, totalTimeoutMs)
      )
    );
    if (first.decision) return { choice: first.decision, status: 'ollama', attemptCount: 1 };
    if (first.failure === 'ollama_http_error' || first.failure === 'timeout')
      return {
        choice: null,
        status: 'ollama_unavailable',
        failureCode: first.failure,
        attemptCount: 1,
      };
    const remainingMs = totalTimeoutMs - (Date.now() - startedAt);
    if (remainingMs < 1000)
      return {
        choice: null,
        status: 'invalid_response',
        failureCode: 'core_retry_exhausted',
        attemptCount: 1,
      };
    const retryPrompt = buildCoreClassificationPromptInput(goals, categories, activity).map(
      (message, index) =>
        index === 1
          ? {
              ...message,
              content: `${message.content}\nRETRY: Return only c, p, r, t, m, g, a JSON fields. Do not add prose.`,
            }
          : message
    );
    const second = resolve(
      await chat(
        retryPrompt,
        coreResponseSchema,
        Math.min(72, ollamaConfig().numPredict),
        Math.min(8000, remainingMs)
      )
    );
    if (second.decision) return { choice: second.decision, status: 'ollama', attemptCount: 2 };
    const failureCode =
      second.failure === 'ollama_http_error' || second.failure === 'timeout'
        ? second.failure
        : 'core_retry_exhausted';
    return {
      choice: null,
      status:
        failureCode === 'ollama_http_error' || failureCode === 'timeout'
          ? 'ollama_unavailable'
          : 'invalid_response',
      failureCode,
      attemptCount: 2,
    };
  }

  async enrich(
    goals: EffectiveGoalContext,
    category: PromptCategory,
    activity: ActivityContext,
    signal?: AbortSignal
  ): Promise<ClassificationEnrichment | null> {
    const result = await chat(
      buildEnrichmentPromptInput(goals, activity, category.name, category.isProductive),
      enrichmentResponseSchema,
      Math.min(96, ollamaConfig().numPredict),
      12000,
      signal
    );
    if (!result.content) return null;
    const parsed = EnrichmentSchema.safeParse(parseStructuredResponse(result.content));
    if (!parsed.success) return null;
    const clip = (value: string, limit: number) => value.trim().slice(0, limit).trim();
    return {
      activityLabel: clip(parsed.data.activityLabel, 48),
      activitySummary: clip(parsed.data.activitySummary, 80),
      reasoning: clip(parsed.data.reasoning.split(/\s+/).slice(0, 12).join(' '), 100),
      nudgeTitle: parsed.data.nudgeTitle ? clip(parsed.data.nudgeTitle, 60) : null,
      nudgeBody: parsed.data.nudgeBody ? clip(parsed.data.nudgeBody, 120) : null,
    };
  }

  async profileGoal(goal: string, signal?: AbortSignal): Promise<GoalSupportProfileData | null> {
    const result = await chat(
      buildGoalSupportProfilePromptInput(goal),
      goalSupportProfileResponseSchema,
      Math.min(64, ollamaConfig().numPredict),
      10000,
      signal
    );
    if (!result.content || signal?.aborted) return null;
    const parsed = GoalSupportProfileSchema.safeParse(parseStructuredResponse(result.content));
    if (!parsed.success) return null;
    const subjectCues = [
      ...new Set(parsed.data.subjectCues.map((cue) => cue.trim()).filter(Boolean)),
    ]
      .slice(0, 6)
      .map((cue) => cue.slice(0, 32));
    const supportingModes = [...new Set(parsed.data.supportingModes)].slice(0, 5);
    // The scheduler computes the stable persisted revision. It is blank here
    // so provider callers never need to retain the goal text or raw response.
    return { subjectCues, supportingModes, revision: '' };
  }
}

export const localClassificationProvider = new OllamaClassificationProvider();
