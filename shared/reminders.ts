/** Apple-owned data is a read-only snapshot; Tempo metadata is stored separately. */
export type ReminderPermission = 'not_determined' | 'granted' | 'denied';
export interface ReminderList {
  id: string;
  name: string;
  accountName: string;
}
export interface ReminderDueDate {
  year: number;
  month: number;
  day: number;
  /** Date-only and floating dates must never be converted through UTC midnight. */
  hour?: number;
  minute?: number;
  timeZone?: string;
  timestampMs?: number;
}
export interface NativeReminder {
  sourceId: string;
  title: string;
  listId: string;
  due: ReminderDueDate | null;
  completed: boolean;
}
export interface ReminderSnapshot {
  lists: ReminderList[];
  reminders: NativeReminder[];
}
export type ReminderFilterRule =
  | { kind: 'due_today' | 'overdue' | 'due_later' | 'no_due_date' }
  | { kind: 'list'; listIds: string[] };
export interface ReminderFilter {
  match: 'any' | 'all';
  rules: ReminderFilterRule[];
}
export const DEFAULT_REMINDER_FILTER: ReminderFilter = {
  match: 'any',
  rules: [{ kind: 'due_today' }, { kind: 'overdue' }],
};
export interface ReminderTask {
  id: string;
  source: 'reminder';
  text: string;
  position: number;
  completedAtMs: null;
  estimatedMinutes: number | null;
  listId: string;
  listName: string;
  due: ReminderDueDate | null;
  focusContext: string;
  customFocusContext: string;
  listFocusContext: string;
  classificationText: string;
}
/** Additive provenance keeps older manual-task sessions readable. */
export interface FocusTaskSource {
  taskId: string;
  dateKey: string;
  source?: 'manual' | 'reminder';
  classificationText?: string;
  listId?: string;
  listName?: string;
  listContext?: string;
}
