import mongoose, { Schema } from 'mongoose';
import type { ToolCapabilityProfile } from '../../../../shared/classification';
import { localClassificationProvider } from './provider';

const schema = new Schema({
  toolKey: { type: String, required: true, unique: true },
  role: { type: String, enum: ['specialized', 'general_purpose', 'unknown'], required: true },
  supportingModes: [String],
  revision: { type: String, required: true },
});
export const ToolProfileModel = mongoose.model('ToolCapabilityProfile', schema);
const pending = new Map<
  string,
  { controller: AbortController; timer: ReturnType<typeof setTimeout> }
>();
const attempted = new Set<string>();
export async function readToolProfile(toolKey: string): Promise<ToolCapabilityProfile | null> {
  const record = await ToolProfileModel.findOne({ toolKey }).lean();
  return record
    ? {
        role: record.role as ToolCapabilityProfile['role'],
        supportingModes: record.supportingModes,
        revision: record.revision,
      }
    : null;
}
export function cancelToolProfiles(userId: string): void {
  for (const [key, item] of pending)
    if (key.startsWith(`${userId}:`)) {
      clearTimeout(item.timer);
      item.controller.abort();
      pending.delete(key);
    }
}
/** The hostname is transient, cleared on completion/cancellation, and never sent to persistence. */
export function scheduleToolProfile(
  userId: string,
  toolKey: string,
  label: string,
  host: string | null
): void {
  const key = `${userId}:${toolKey}`;
  if (attempted.has(key) || pending.has(key)) return;
  const controller = new AbortController();
  const timer = setTimeout(async () => {
    try {
      const profile = await localClassificationProvider.profileTool(label, host, controller.signal);
      if (profile && !controller.signal.aborted)
        await ToolProfileModel.updateOne({ toolKey }, { $set: profile }, { upsert: true });
      if (!controller.signal.aborted) attempted.add(key);
    } catch {
      /* Best effort; foreground inference and privacy take precedence. */
    } finally {
      host = null;
      pending.delete(key);
    }
  }, 350);
  pending.set(key, { controller, timer });
}
