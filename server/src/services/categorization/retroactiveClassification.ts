import mongoose from 'mongoose';
import { ActiveWindowEventModel } from '../../models/activeWindowEvent';

/** The part of an event that decides whether a correction should carry over to it. */
export interface RetroactiveEvent {
  type: 'window' | 'browser' | 'system';
  ownerName: string;
  learningToolKey?: string | null;
  categoryId?: string | null;
  classificationStatus?: string;
  goalSnapshot?: { sessionId?: string | null } | null;
}

export interface RetroactiveScope {
  /** Focus sessions the corrected events belong to. */
  sessionIds: Set<string>;
  /** Opaque tool identities of the corrected events. */
  toolKeys: Set<string>;
  /** Owners of corrected events that have no tool identity to match on. */
  ownerNames: Set<string>;
}

const normalizeOwner = (name: string) => name.normalize('NFC').trim().toLowerCase();

/**
 * A manual correction speaks for the same tool in the same focus session, never
 * for a different app or for time outside the session. Events without a session
 * have no boundary to extend across, so they produce an empty scope.
 */
export function retroactiveScope(corrected: RetroactiveEvent[]): RetroactiveScope {
  const scope: RetroactiveScope = {
    sessionIds: new Set(),
    toolKeys: new Set(),
    ownerNames: new Set(),
  };
  for (const event of corrected) {
    const sessionId = event.goalSnapshot?.sessionId;
    if (!sessionId || event.type === 'system') continue;
    scope.sessionIds.add(sessionId);
    if (event.learningToolKey) scope.toolKeys.add(event.learningToolKey);
    else if (event.type === 'window') scope.ownerNames.add(normalizeOwner(event.ownerName));
  }
  return scope;
}

/** An event is uncertain when classification left it without any category. */
export const isUncertainEvent = (event: Pick<RetroactiveEvent, 'categoryId'>) =>
  !event.categoryId;

export function matchesRetroactiveScope(
  event: RetroactiveEvent,
  scope: RetroactiveScope
): boolean {
  const sessionId = event.goalSnapshot?.sessionId;
  if (!sessionId || !scope.sessionIds.has(sessionId)) return false;
  if (!isUncertainEvent(event) || event.classificationStatus === 'manual') return false;
  if (event.type === 'system') return false;
  if (event.learningToolKey) return scope.toolKeys.has(event.learningToolKey);
  return event.type === 'window' && scope.ownerNames.has(normalizeOwner(event.ownerName));
}

/** Ids of uncertain events a correction should also cover, excluding the corrected ones. */
export async function findRetroactiveEventIds(
  userId: string,
  corrected: Array<RetroactiveEvent & { _id: mongoose.Types.ObjectId }>
): Promise<mongoose.Types.ObjectId[]> {
  const scope = retroactiveScope(corrected);
  if (!scope.sessionIds.size) return [];
  const candidates = await ActiveWindowEventModel.find({
    userId,
    'goalSnapshot.sessionId': { $in: [...scope.sessionIds] },
    _id: { $nin: corrected.map((event) => event._id) },
    $or: [{ categoryId: null }, { categoryId: '' }, { categoryId: { $exists: false } }],
  })
    .select('type ownerName learningToolKey categoryId classificationStatus goalSnapshot.sessionId')
    .lean();
  return (candidates as unknown as Array<RetroactiveEvent & { _id: mongoose.Types.ObjectId }>)
    .filter((event) => matchesRetroactiveScope(event, scope))
    .map((event) => event._id);
}
