import { z } from 'zod';
import { ActiveWindowDetails, Category as CategoryType } from '../../../../shared/types';
import {
  buildCoreClassificationPromptInput,
  buildEnrichmentPromptInput,
  buildGoalSupportProfilePromptInput,
  buildGoalRelationPromptInput,
  buildPageInterpretationPromptInput,
  CoreClassificationDecisionSchema,
  EnrichmentSchema,
  EffectiveGoalContext,
  GoalSupportProfileSchema,
  GoalRelationDecisionSchema,
  PageActivityDescriptorSchema,
} from './llm';
import { GoalSupportProfileData, SUPPORTING_MODES, isSupportingMode } from './goalSupportTypes';
import type { PageActivityDescriptorData } from './pageDescriptorTypes';

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
  'ownerName' | 'title' | 'url' | 'siteHost' | 'content' | 'contentSource' | 'type' | 'browser'
>;
type PromptCategory = Pick<CategoryType, 'name' | 'description' | 'isProductive'>;

export interface ClassificationProviderResult {
  choice: CoreClassificationDecision | null;
  status: Exclude<ClassificationStatus, 'history'>;
  failureCode?: ClassificationFailureCode;
  attemptCount: number;
}

export type GoalRelationDecision = z.infer<typeof GoalRelationDecisionSchema> & {
  matchedGoalRef: string | null;
};

export interface GoalRelationProviderResult {
  decision: GoalRelationDecision | null;
  failureCode?: ClassificationFailureCode;
  attemptCount: number;
}

export interface ClassificationProvider {
  classify(
    goals: EffectiveGoalContext,
    categories: PromptCategory[],
    activity: ActivityContext
  ): Promise<ClassificationProviderResult>;
  describePage(
    activity: ActivityContext,
    source: 'dom' | 'ocr' | 'title',
    timeoutMs: number
  ): Promise<{
    descriptor: Omit<PageActivityDescriptorData, 'revision'> | null;
    failureCode?: ClassificationFailureCode;
  }>;
  decideRelation(
    goals: EffectiveGoalContext,
    categories: PromptCategory[],
    descriptor: Omit<PageActivityDescriptorData, 'revision'>,
    timeoutMs: number
  ): Promise<GoalRelationProviderResult>;
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
    // Keep the wire protocol deliberately tiny. `c` is the useful semantic
    // decision; target/method fields merely qualify productive work and must
    // never make a clear distraction reply invalid.
    v: { type: 'string', enum: ['productive', 'distracting', 'uncertain'] },
    c: { type: ['string', 'null'], maxLength: 64 },
    t: { type: ['string', 'null'], maxLength: 4 },
    m: {
      type: ['string', 'null'],
      enum: [
        'direct',
        'calculation_or_visualization',
        'study_notes_or_retrieval',
        'read_reference',
        'coding_or_analysis',
        'drafting_or_problem_solving',
        null,
      ],
    },
  },
  required: ['v', 'c', 't', 'm'],
};

const goalSupportProfileResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subjectCues: { type: 'array', items: { type: 'string', maxLength: 32 }, maxItems: 6 },
    expectedOutcome: { type: 'string', maxLength: 120 },
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
  required: ['subjectCues', 'expectedOutcome', 'supportingModes'],
};

const pageDescriptorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    k: {
      type: 'string',
      enum: [
        'problem_solving',
        'learning',
        'reference',
        'note_taking',
        'coding',
        'writing',
        'communication',
        'administration',
        'social',
        'entertainment',
        'shopping',
        'general_browsing',
        'other',
        'unknown',
      ],
    },
    a: { type: 'string', maxLength: 60 },
    q: { type: 'array', items: { type: 'string', maxLength: 32 }, maxItems: 6 },
    e: { type: 'string', enum: ['strong', 'partial', 'weak'] },
  },
  required: ['k', 'a', 'q', 'e'],
};

const relationResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    s: { type: 'string', enum: ['focused', 'distracted'] },
    r: { type: 'string', enum: ['direct', 'supporting', 'none'] },
    t: { type: ['string', 'null'], maxLength: 4 },
    m: { type: ['string', 'null'], enum: [...SUPPORTING_MODES, null] },
    p: { type: 'string', enum: ['high', 'medium', 'low'] },
    c: { type: ['string', 'null'], maxLength: 64 },
  },
  required: ['s', 'r', 't', 'm', 'p', 'c'],
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
  let categoryFromName = categories.find(
    (category) => category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
  );
  const rawVerdict = raw.v ?? raw.verdict;
  const requestedVerdict =
    rawVerdict === 'productive' || rawVerdict === 'distracting' || rawVerdict === 'uncertain'
      ? rawVerdict
      : null;
  const rawGoalRefValue = raw.t ?? raw.matchedGoalRef;
  const rawGoalRef =
    typeof rawGoalRefValue === 'string'
      ? rawGoalRefValue.trim().replace(/^['"`]+|['"`]+$/g, '')
      : null;
  const rawSupportingMode = raw.m ?? raw.supportingMode;
  const supportsDirectWork = rawSupportingMode === 'direct';
  const supportingMode = isSupportingMode(rawSupportingMode) ? rawSupportingMode : null;
  // Qwen occasionally places an otherwise valid work method in `c` while
  // also providing the correct target/method fields. Recover only that exact
  // structural mix-up; do not treat arbitrary unknown category strings as
  // productive work.
  if (
    !categoryFromName &&
    requestedVerdict === 'productive' &&
    rawGoalRef &&
    (supportsDirectWork || supportingMode) &&
    (supportsDirectWork || isSupportingMode(name))
  ) {
    categoryFromName =
      categories.find(
        (category) => category.isProductive && category.name.trim().toLowerCase() === 'work'
      ) || categories.find((category) => category.isProductive);
  }
  // A recognized local category is the model's actual semantic decision.
  // Prefer it over contradictory optional fields; only an absent category is
  // genuinely uncertain. This is what lets ordinary messaging stay useful
  // when a small model is sloppy about its explanatory relation.
  const verdict = categoryFromName
    ? categoryFromName.isProductive
      ? 'productive'
      : 'distracting'
    : requestedVerdict === 'uncertain'
      ? 'uncertain'
      : null;
  if (!verdict) return { decision: null, failure: 'unknown_category' };
  const chosenCategoryName = categoryFromName?.name || null;
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
      : null;
  const normalizedConfidence =
    typeof confidence === 'number' &&
    Number.isFinite(confidence) &&
    confidence >= 0 &&
    confidence <= 1
      ? confidence
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
  const goalRelation =
    verdict === 'distracting'
      ? 'none'
      : verdict === 'productive' && supportsDirectWork
        ? 'direct'
        : verdict === 'productive' && supportingMode
          ? 'supporting'
          : 'insufficient';
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
  return {
    decision: {
      chosenCategoryName,
      verdict,
      confidence: normalizedConfidence,
      goalRelation,
      matchedGoalRef: verdict === 'productive' ? matchedGoalRef : null,
      supportingMode: verdict === 'productive' ? supportingMode : null,
      goalEvidence: verdict === 'productive' ? goalEvidence : null,
      activityEvidence: verdict === 'productive' ? activityEvidence : null,
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
  async describePage(
    activity: ActivityContext,
    source: 'dom' | 'ocr' | 'title',
    timeoutMs: number
  ): Promise<{
    descriptor: Omit<PageActivityDescriptorData, 'revision'> | null;
    failureCode?: ClassificationFailureCode;
  }> {
    const result = await chat(
      buildPageInterpretationPromptInput(activity),
      pageDescriptorResponseSchema,
      Math.min(72, ollamaConfig().numPredict),
      Math.max(500, timeoutMs)
    );
    if (!result.content) return { descriptor: null, failureCode: result.failure };
    const parsed = parseStructuredResponse(result.content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { descriptor: null, failureCode: 'invalid_json' };
    const raw = parsed as Record<string, unknown>;
    const checked = PageActivityDescriptorSchema.safeParse({
      pageKind: raw.k ?? raw.pageKind,
      actionLabel: raw.a ?? raw.actionLabel,
      topicCues: raw.q ?? raw.topicCues,
      evidenceQuality: raw.e ?? raw.evidenceQuality,
    });
    if (!checked.success) return { descriptor: null, failureCode: 'invalid_decision_shape' };
    return {
      descriptor: {
        pageKind: checked.data.pageKind,
        actionLabel: checked.data.actionLabel.trim().slice(0, 60),
        topicCues: [
          ...new Set(checked.data.topicCues.map((cue) => cue.trim()).filter(Boolean)),
        ].slice(0, 6),
        evidenceQuality: checked.data.evidenceQuality,
        source,
      },
    };
  }

  async decideRelation(
    goals: EffectiveGoalContext,
    categories: PromptCategory[],
    descriptor: Omit<PageActivityDescriptorData, 'revision'>,
    timeoutMs: number
  ): Promise<GoalRelationProviderResult> {
    const startedAt = Date.now();
    const parse = (result: { content: string | null; failure?: ClassificationFailureCode }) => {
      if (!result.content) return { decision: null, failure: result.failure };
      const parsed = parseStructuredResponse(result.content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return { decision: null, failure: 'invalid_json' as const };
      const raw = parsed as Record<string, unknown>;
      const checked = GoalRelationDecisionSchema.safeParse({
        state: raw.s ?? raw.state,
        relation: raw.r ?? raw.relation,
        targetAlias: raw.t ?? raw.targetAlias ?? null,
        supportingMode: raw.m ?? raw.supportingMode ?? null,
        confidence: raw.p ?? raw.confidence,
        categoryAlias: raw.c ?? raw.categoryAlias ?? null,
      });
      if (!checked.success) return { decision: null, failure: 'invalid_decision_shape' as const };
      const alias = checked.data.targetAlias?.trim().toUpperCase() || null;
      const target = alias
        ? (goals.targets || [])[Math.max(0, Number(alias.slice(1)) - 1)] ||
          (goals.targets || []).find((item) => item.ref === checked.data.targetAlias)
        : null;
      return {
        decision: {
          ...checked.data,
          matchedGoalRef: target?.ref || null,
        } as GoalRelationDecision,
      };
    };
    const prompt = buildGoalRelationPromptInput(goals, descriptor, categories);
    const first = parse(
      await chat(prompt, relationResponseSchema, Math.min(56, ollamaConfig().numPredict), timeoutMs)
    );
    if (first.decision) return { decision: first.decision, attemptCount: 1 };
    if (first.failure === 'timeout' || first.failure === 'ollama_http_error')
      return { decision: null, failureCode: first.failure, attemptCount: 1 };
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining < 500)
      return { decision: null, failureCode: 'core_retry_exhausted', attemptCount: 1 };
    const retry = prompt.map((message, index) =>
      index === 1
        ? { ...message, content: `${message.content}\nRETRY: Return only s,r,t,m,p,c JSON.` }
        : message
    );
    const second = parse(
      await chat(retry, relationResponseSchema, Math.min(40, ollamaConfig().numPredict), remaining)
    );
    return second.decision
      ? { decision: second.decision, attemptCount: 2 }
      : {
          decision: null,
          failureCode:
            second.failure === 'timeout' || second.failure === 'ollama_http_error'
              ? second.failure
              : 'core_retry_exhausted',
          attemptCount: 2,
        };
  }

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
        Math.min(56, ollamaConfig().numPredict),
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
              content: `${message.content}\nRETRY: Return only v, c, t, m JSON fields. Do not add prose.`,
            }
          : message
    );
    const second = resolve(
      await chat(
        retryPrompt,
        coreResponseSchema,
        Math.min(40, ollamaConfig().numPredict),
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
    return {
      subjectCues,
      expectedOutcome: parsed.data.expectedOutcome.trim().slice(0, 120),
      supportingModes,
      revision: '',
    };
  }
}

export const localClassificationProvider = new OllamaClassificationProvider();
