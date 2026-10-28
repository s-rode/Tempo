# Apple Calendar

Connect Apple Calendar in **Settings → Planning and focus → Apple Calendar**, then choose the calendars you want to see. macOS requests Calendar access. Tempo's EventKit bridge only reads event titles, times, locations and calendar colors; it exposes no event creation, editing or deletion operation. Calendar data stays on this Mac and is not sent to the classifier.

The daily view compares **Calendar** and **Tracked** on one time scale. Overlapping appointments occupy separate rows; all-day events appear above the ruler. Event cards show the full title and time. Calendar bookings do not add time to tracking totals. The activity timeline below retains its goal-based blocks and chronological details.

Enable **Ask to pause tracking for events** and set **Ask … minutes before the event**. Zero prompts at the start; ten prompts ten minutes early. The notch offers **Pause during event** and **Keep tracking**. Accepting early schedules the pause for the start, and ignoring a prompt never pauses automatically. The preview button exercises the notch without changing tracking.

Accepted pauses stop both foreground capture and focus timers. Tracking resumes after the event ends and a fresh foreground activity arrives. Overlapping accepted events keep tracking paused until the last accepted event ends. A separate manual pause, screen lock or Pomodoro state still applies. **Resume now** ends the calendar pause early; disconnecting clears calendar-owned pauses.

All-day, cancelled and declined events never prompt. Event edits and deletions are refreshed through EventKit notifications and periodic recovery. Saved occurrence choices survive app restarts. Calendar access is requested only when you connect; revoking permission clears the calendar display and its active pause.

Calendar choices and pause decisions are stored in the local Electron profile's `calendar-preferences.json`. Event titles and locations are held in memory; the activity database receives only generic Calendar Pause/Resume boundaries and opaque occurrence identifiers on its active runtime.

Validation: `bun run test:electron`, `bun run test:server`, `bun run --cwd electron-app test:notch-controller`, and `bun server/scripts/verify-calendar.ts`. The integration script uses and removes a uniquely named disposable MongoDB database. It verifies pause accounting, late-capture rejection, automatic expiry, independent manual pauses, and resuming only after fresh activity.
