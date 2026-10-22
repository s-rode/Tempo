# Apple Reminders in Tempo

Connect under **Settings → Planning → Apple Reminders**. Tempo requests access only after Connect. macOS grants full Reminders access, but the integration exposes only reading operations. Edit and complete reminders in Reminders itself.

The connected task list replaces manual Tempo tasks and defaults to unfinished reminders due today or overdue. Filters support due today, overdue, due later, no due date, and selected lists, combined with **any** or **all**. Empty rules mean all unfinished reminders. Native tags are deferred.

Set **Focus context by list** once to explain short titles. An optional reminder-specific context replaces that list default; clearing it restores inheritance. Estimates and context stay in Tempo. Context changes update live classification and create timestamped segments in active focus sessions without changing earlier history or resetting the timer. Finishing a focus session never completes a reminder.

Disconnect restores manual tasks. Imported metadata and focus history remain saved. Past calendar days show recorded plans and sessions, not a reconstruction of the current Reminders database. New Apple reminder identities (including new recurring occurrences) receive separate Tempo metadata; names are never used to guess identity.

## Development verification

- Build `shared`, then `server`, before Electron type checks so referenced declarations are current.
- Backend regressions: `cd server && bun test src`.
- Sync coordinator regressions: `cd electron-app && bun test tests/reminderSyncCoordinator.test.ts`.
- Persistence verification: `cd server && bun scripts/verify-reminders.ts`. Requires MongoDB on local port 27017; creates and removes a uniquely named test database, without accessing the user's Tempo database or Apple reminders.
- Rebuild the native Electron module after changes to the EventKit bridge, then run Electron type checks and `bun run build:mac:local`. Use Node 22 or invoke the rebuild CLI through Bun if the installed Node version is incompatible with the older electron-rebuild dependency.
- Verify the installed app's code signature and Reminders usage descriptions. Connection stays off until the user explicitly enables it.
