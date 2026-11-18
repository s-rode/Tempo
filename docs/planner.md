# Tempo's built-in planner

An alternative to Apple Reminders as the source of Today's tasks. Choose it under **Settings → Planning → Tasks come from**. Reminders stays connected while the planner is on, and switching back restores it unchanged.

With the planner on, a **Plan** page appears in the sidebar (⌘4) with three views.

## Goals

Long-term goals with a colour, an optional symbol and a note on why they matter. A goal can be marked as achieved and reopened. Deleting a goal keeps its tasks and only clears their link.

## Week

Seven day columns, Monday to Sunday. A task belongs to a day, not to a time of day. Drag a task within a column to set its place in that day's queue, or to another column to plan it for another day. Each task can link to one goal and carry a time estimate.

Quick entry understands a goal tag and a duration: `Draft chapter 3 #thesis 45m`. A tag links a goal only when it matches exactly one unfinished goal.

Unfinished tasks from earlier days move to the end of today's queue the next day and show the day they were first planned for. Finished tasks stay on the day they were done. Carry-over starts on the day the planner was switched on, so older manual tasks are not pulled in.

## Queue

Today's tasks in working order. **Start Working** (⌘↵) begins an ordinary Tempo focus session on the first task, so the timer, the notch, distraction alerts and the day timeline behave as for any other session. While working, the page shows that one task only.

- **Done** (⌘↵) completes the task and, unless switched off, starts the next one at once.
- **Later** sends the task to the back of the queue and continues with the next.
- **Stop** ends the session and keeps the task in the queue.

A task with an estimate runs for that long before Tempo asks whether to finish or add time. Tasks without one use the session length chosen in the queue.

## Keyboard

| Key | Action |
| --- | --- |
| ⌘↵ | Start working, or complete the task in focus |
| N | New task for today |
| G | New goal |
| T, [ and ] | This week, previous week, next week |
| Space | Mark the focused task done or not done |
| ↵ | Rename the focused task |
| ⌥↑ ⌥↓ | Move the focused task within its day |
| ⌥← ⌥→ | Move the focused task to the previous or next day |
| ⌫ | Delete the focused task |
| ⌘Z | Undo the last plan change |

Every task and goal also has a context menu with the same actions.

## Data

Planner tasks live in the existing daily `GoalPlan` records (one per local day), with an optional `goalId` and `carriedFromDateKey` per task. Goals are `PlannerGoal` records. The choice of source is `electronAppSettings.planningSource`. Analysis does not use goals yet.

## Development verification

- Backend: `cd server && bun test src/services/plannerTasks.test.ts src/services/plannerState.test.ts`.
- Renderer model: `cd electron-app && bun test src/renderer/src/lib/plannerModel.test.ts`.
