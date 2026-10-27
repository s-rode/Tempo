import { DISTRACTION_NUDGE_VERSION, usableDistractionNudge } from '../../../../shared/distractionNudge';
import { ActiveWindowEventModel } from '../../models/activeWindowEvent';
import { CategoryModel } from '../../models/category';
import { User } from '../../models/user';
import { getOrCreateRuntime, suspensionReasonsFor } from '../focusRuntime';
import { resolveGoalContext } from './categorizationService';
import { localClassificationProvider } from './provider';
import { requestDistractionNudge } from './distractionNudgeRequests';

const technicalStatuses = new Set(['ollama_unavailable', 'invalid_response', 'ocr_unavailable', 'insufficient_context']);

/** Only a due reminder may request this optional, bounded local inference. */
export async function prepareDistractionNotification(userId: string, eventId: string) {
  const eligible = async () => {
    const [event, context, runtime, user] = await Promise.all([
      ActiveWindowEventModel.findOne({ userId }).sort({ timestamp: -1 }).lean(),
      resolveGoalContext(userId), getOrCreateRuntime(userId),
      User.findById(userId).select('electronAppSettings.showDistractionNotifications').lean(),
    ]);
    if (!event || String(event._id) !== eventId || event.type === 'system' ||
        technicalStatuses.has(event.classificationStatus || '') ||
        event.goalContextFingerprint !== context.fingerprint ||
        suspensionReasonsFor(runtime).length ||
        user?.electronAppSettings?.showDistractionNotifications === false) return null;
    const category = event.categoryId
      ? await CategoryModel.findOne({ _id: event.categoryId, userId }).select('isProductive').lean()
      : null;
    return category?.isProductive === false ? { event, context } : null;
  };
  const current = await eligible();
  if (!current) return null;
  const existing = usableDistractionNudge(current.event.nudgeTitle, current.event.nudgeBody);
  if (existing && current.event.nudgeVersion === DISTRACTION_NUDGE_VERSION) return { copy: existing };
  // Without a supplied goal, keep the existing honest fallback rather than
  // inventing a task or spending model work on generic motivational copy.
  if (!current.context.goals.primaryGoal) return { copy: null };
  const key = `${eventId}:${current.context.fingerprint}`;
  const copy = await requestDistractionNudge(userId, key, signal =>
    localClassificationProvider.distractionNudge(
      current.context.goals.primaryGoal!, current.event, signal
    )
  );
  const after = await eligible();
  if (!after || after.context.fingerprint !== current.context.fingerprint) return null;
  if (copy) await ActiveWindowEventModel.updateOne(
    { _id: eventId, userId, categoryId: current.event.categoryId,
      goalContextFingerprint: current.context.fingerprint },
    { $set: { nudgeTitle: copy.title, nudgeBody: copy.body, nudgeVersion: DISTRACTION_NUDGE_VERSION } }
  );
  return { copy };
}
