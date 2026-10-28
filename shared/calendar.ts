export type CalendarPermission = 'not_determined' | 'granted' | 'denied';
export interface AppleCalendar {
  id: string;
  title: string;
  accountName: string;
  color: string;
}
export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location?: string;
}
export interface CalendarSnapshot {
  calendars: AppleCalendar[];
  events: CalendarEvent[];
}
export interface CalendarPreferences {
  enabled: boolean;
  selectedCalendarIds: string[] | null;
  askToPause: boolean;
  leadMinutes: number;
}
export interface CalendarStatus extends CalendarSnapshot {
  preferences: CalendarPreferences;
  permission: CalendarPermission;
  error: string | null;
  updatedAtMs: number | null;
  pauseUntilMs: number | null;
  scheduledPauseIds: string[];
}
export interface CalendarPauseNotice {
  id: string;
  title: string;
  calendarName: string;
  startMs: number;
  endMs: number;
  preview?: boolean;
}
export const defaultCalendarPreferences: CalendarPreferences = {
  enabled: false,
  selectedCalendarIds: null,
  askToPause: true,
  leadMinutes: 0,
};
