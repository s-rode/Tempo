import { NavigationEpisodeModel } from '../../models/classificationEpisode';
import crypto from 'crypto';
import type {
  ActiveWindowEvent,
  ClassificationContextSnapshot,
  HistoricalGoalTarget,
} from '../../../../shared/types';
import { CorrectionActionModel, PreferenceControlModel } from '../../models/correctionAction';
import { ClassifierFeedbackModel } from '../../models/classifierFeedback';
import { ActiveWindowEventModel } from '../../models/activeWindowEvent';
import { FocusRunHistoryModel, FocusRuntimeModel } from '../../models/focusRuntime';
import { User } from '../../models/user';
import { consolidatePreferences } from './personalizedPolicy';
import type { ClassifierStrictness } from '../../../../shared/types';

export async function loadPreferences(
  userId: string,
  toolKey: string,
  strictness: ClassifierStrictness,
  now = Date.now()
) {
  const [actions, controls] = await Promise.all([
    CorrectionActionModel.find({ userId, toolKey }).sort({ occurredAtMs: -1 }).lean(),
    PreferenceControlModel.find({ userId }).lean(),
  ]);
  return consolidatePreferences(actions, strictness, now, controls as any);
}

type EventForLearning = Omit<Partial<ActiveWindowEvent>, 'title' | 'classificationStatus'> & {
  _id: unknown;
  title?: string | null;
  classificationStatus?: string;
};
export function correctionGroups(events: EventForLearning[], goalRef?: string) {
  const groups = new Map<
    string,
    { events: EventForLearning[]; target: HistoricalGoalTarget; sessionId: string | null }
  >();
  const reasons = new Set<string>();
  for (const event of events) {
    const snapshot = event.goalSnapshot;
    if (!event.learningToolKey) {
      reasons.add('missing_tool_identity');
      continue;
    }
    if (!snapshot?.targets.length) {
      reasons.add('historical_context_unavailable');
      continue;
    }
    const ref = goalRef || event.matchedGoalRef || event.semanticProposal?.matchedGoalRef;
    const target =
      (ref ? snapshot.targets.find((t) => t.ref === ref) : null) ||
      (snapshot.targets.length === 1 ? snapshot.targets[0] : null);
    if (!target) {
      reasons.add('ambiguous_historical_goal');
      continue;
    }
    const mode =
      event.semanticProposal?.supportingMode ||
      event.supportingMode ||
      target.supportingModes[0] ||
      null;
    const key = JSON.stringify([
      event.learningToolKey,
      target.taskKey,
      target.listKey,
      snapshot.sessionId,
      mode,
    ]);
    const group = groups.get(key) || { events: [], target, sessionId: snapshot.sessionId };
    group.events.push(event);
    groups.set(key, group);
  }
  return { groups: [...groups.values()], reasons: [...reasons] };
}

export async function recordCorrectionActions(input: {
  userId: string;
  events: EventForLearning[];
  state: 'focused' | 'distracted';
  categoryId: string;
  enabled: boolean;
  goalRef?: string;
  source?: 'correction' | 'review';
  strictness?: ClassifierStrictness;
  originalPolarity: Map<string, boolean>;
  actionId?: string;
}) {
  await CorrectionActionModel.init();
  const { groups, reasons } = correctionGroups(input.events, input.goalRef);
  if (!input.enabled) return { created: 0, reasons: ['learning_disabled'], scope: 'none' as const };
  const now = Date.now(),
    rootId = input.actionId || crypto.randomUUID();
  let created = 0;
  const originalStateOf = (event: EventForLearning): 'focused' | 'distracted' | 'uncertain' => {
    const productive = event.categoryId ? input.originalPolarity.get(event.categoryId) : undefined;
    return productive === undefined ? 'uncertain' : productive ? 'focused' : 'distracted';
  };
  for (const group of groups) {
    const first = group.events[0];
    const eventIds = group.events.map((e) => String(e._id));
    const originalState = originalStateOf(first);
    const supportingMode =
      first.semanticProposal?.supportingMode ||
      first.supportingMode ||
      group.target.supportingModes[0] ||
      null;
    const actionId = crypto
      .createHash('sha256')
      .update(
        JSON.stringify([
          rootId,
          first.learningToolKey,
          group.target.taskKey,
          group.sessionId,
          supportingMode,
        ])
      )
      .digest('hex');
    const exists = await CorrectionActionModel.exists({ userId: input.userId, actionId });
    if (exists) continue;
    // Superseded observations are retained for evaluation, excluded from active trust.
    await CorrectionActionModel.updateMany(
      { userId: input.userId, eventIds: { $in: eventIds }, superseded: false },
      { $set: { superseded: true } }
    );
    await CorrectionActionModel.updateOne(
      { userId: input.userId, actionId },
      {
        $setOnInsert: {
          userId: input.userId,
          actionId,
          rootActionId: rootId,
          eventIds,
          source: input.source || 'correction',
          state: input.state,
          originalState,
          originalDecisions: group.events.map((event) => ({
            eventId: String(event._id),
            categoryId: event.categoryId || null,
            state: originalStateOf(event),
          })),
          toolKey: first.learningToolKey,
          toolLabel: first.learningToolLabel || first.ownerName || 'Tool',
          context: group.target,
          sessionId: group.sessionId,
          supportingMode,
          occurredAtMs: now,
          superseded: false,
        },
      },
      { upsert: true }
    );
    created++;
    if (input.state === 'focused')
      await NavigationEpisodeModel.updateOne(
        {
          userId: input.userId,
          key: `${first.learningToolKey}:${group.target.taskKey}:${group.sessionId || 'none'}`,
        },
        { $set: { startedAtMs: now } }
      );
    await Promise.all(
      group.events.map((event) =>
        ClassifierFeedbackModel.updateOne(
          { userId: input.userId, sourceEventId: String(event._id) },
          {
            $set: { correctedCategoryId: input.categoryId, learningEligible: false },
            $setOnInsert: {
              userId: input.userId,
              sourceEventId: String(event._id),
              originalCategoryId: event.categoryId || null,
              originalState: originalStateOf(event),
              classifierVersion: 'contextual-v2',
              effectiveGoalRef: group.target.ref,
            },
          },
          { upsert: true }
        )
      )
    );
  }
  if (created)
    await User.updateOne({ _id: input.userId }, { $inc: { classificationLearningRevision: 1 } });
  let broad = false;
  if (created)
    for (const group of groups) {
      const tool = group.events[0].learningToolKey;
      if (tool && group.target.listKey) {
        const preferences = await loadPreferences(input.userId, tool, input.strictness || 'strict');
        if (
          preferences.some(
            (p) => p.scope === 'list' && p.key === group.target.listKey && !p.conflicted
          )
        )
          broad = true;
      }
    }
  return {
    created,
    reasons,
    scope: created ? (broad ? ('list' as const) : ('task' as const)) : ('none' as const),
  };
}

const migrations = new Map<string, Promise<void>>();
/** Do not invent list provenance from prose. Old derived examples remain task-scoped when recovery is impossible. */
export function migrateLegacyLearning(userId: string): Promise<void> {
  const running = migrations.get(userId);
  if (running) return running;
  const work = (async () => {
    const user = await User.findById(userId)
      .select('classificationLearningMigrationVersion')
      .lean();
    if (user?.classificationLearningMigrationVersion === 2) return;
    await CorrectionActionModel.init();
    const legacy = await ClassifierFeedbackModel.find({ userId, learningEligible: true }).lean();
    if (!legacy.length) {
      await User.updateOne(
        { _id: userId },
        { $set: { classificationLearningMigrationVersion: 2 } }
      );
      return;
    }
    const [histories, runtime] = await Promise.all([
      FocusRunHistoryModel.find({ userId }).select('run').lean(),
      FocusRuntimeModel.findOne({ userId }).select('run').lean(),
    ]);
    const runs = [...histories.map((h) => h.run), runtime?.run].filter(Boolean) as any[];
    for (const record of legacy) {
      if (!record.learningToolKey || !record.learnedState) continue;
      const source = await ActiveWindowEventModel.findOne({ userId, _id: record.sourceEventId })
        .select('goalSnapshot timestamp')
        .lean();
      let snapshot = source?.goalSnapshot as ClassificationContextSnapshot | null;
      if (!snapshot) {
        const matches = runs.flatMap((run) =>
          (run.phases || [])
            .filter((p: any) => `session:${run.id}:${p.id}` === record.learningGoalRef)
            .map((p: any) => ({ run, p }))
        );
        if (matches.length === 1) {
          const { run, p } = matches[0];
          const segments = p.goalHistory?.length
            ? p.goalHistory
            : [{ goal: p.goal, todayPlanTask: p.todayPlanTask, startedAtMs: p.startedAtMs }];
          const eligible = segments
            .filter((x: any) => x.startedAtMs <= Number(source?.timestamp || 0))
            .sort((a: any, b: any) => b.startedAtMs - a.startedAtMs);
          const segment = eligible[0];
          if (segment) {
            const task = segment.todayPlanTask;
            snapshot = {
              version: 2,
              scope: 'session',
              sessionId: run.id,
              targets: [
                {
                  ref: record.learningGoalRef || '',
                  taskKey:
                    task?.taskId ||
                    crypto
                      .createHash('sha256')
                      .update(segment.goal.toLowerCase().replace(/\s+/g, ' ').trim())
                      .digest('hex'),
                  text: segment.goal.slice(0, 500),
                  classificationText: (task?.classificationText || segment.goal).slice(0, 1800),
                  listKey: task?.listId
                    ? crypto
                        .createHmac('sha256', process.env.AUTH_SECRET || 'local-development-secret')
                        .update(`list:${task.listId}`)
                        .digest('hex')
                    : null,
                  listName: task?.listName || null,
                  listContext: task?.listContext || null,
                  supportingModes: record.goalSupportingModes || [],
                  profileRevision: null,
                },
              ],
            };
          }
        }
      }
      const context = snapshot?.targets.find((t) => t.ref === record.learningGoalRef) ||
        (snapshot?.targets.length === 1 ? snapshot.targets[0] : null) || {
          ref: record.learningGoalRef || `legacy:${record._id}`,
          taskKey: crypto
            .createHash('sha256')
            .update(record.goalExpectedOutcome || String(record._id))
            .digest('hex'),
          text: record.goalExpectedOutcome || 'Previous goal',
          classificationText: record.goalExpectedOutcome || '',
          listKey: null,
          listName: null,
          listContext: null,
          supportingModes: record.goalSupportingModes || [],
          profileRevision: null,
        };
      // Legacy independence is unproven: conservatively cluster matching tool/goal/state within 30 seconds.
      const actionId = crypto
        .createHash('sha256')
        .update(
          JSON.stringify([
            'legacy-v2',
            record.learningToolKey,
            record.learningGoalRef,
            record.learnedState,
            Math.floor(record.updatedAt.getTime() / 30_000),
          ])
        )
        .digest('hex');
      await CorrectionActionModel.updateOne(
        { userId, actionId },
        {
          $setOnInsert: {
            userId,
            actionId,
            eventIds: [record.sourceEventId],
            rootActionId: `legacy:${Math.floor(record.updatedAt.getTime() / 30_000)}:${record.learnedState}`,
            source: 'legacy',
            state: record.learnedState,
            originalState: record.originalState,
            toolKey: record.learningToolKey,
            toolLabel: record.learningToolLabel || 'Tool',
            context,
            sessionId: snapshot?.sessionId || null,
            supportingMode:
              record.activitySupportingMode ||
              (context.supportingModes.length === 1 ? context.supportingModes[0] : null),
            occurredAtMs: record.updatedAt.getTime(),
            superseded: false,
          },
        },
        { upsert: true }
      );
    }
    await User.updateOne(
      { _id: userId },
      {
        $set: { classificationLearningMigrationVersion: 2 },
        $inc: { classificationLearningRevision: 1 },
      }
    );
  })();
  migrations.set(userId, work);
  work.catch(() => migrations.delete(userId));
  return work;
}
