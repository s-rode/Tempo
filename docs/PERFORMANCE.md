# Performance checks

Tempo keeps native activity capture, classification, system-boundary delivery,
server-owned session deadlines, and the notch's one-second live clocks running
independently of dashboard visibility. Chromium background throttling remains
disabled because the renderer still commits activity captures.

Dashboard-only work uses Electron's actual window visibility. Hiding or minimizing
the window stops the weekly comparison clock, plan polling, Reminders age labels,
and an open task-progress clock. Reopening refreshes presentation immediately.

A successful Reminders heartbeat still checks EventKit and records freshness.
Unchanged lists/items no longer rewrite the full snapshot, touch every metadata
row, cancel enrichment, or trigger a new activity capture. Actual edits, permission
and error transitions, recovery, and local calendar/timezone changes still refresh
goal context. Apple Reminders remains read-only.

Analytics sorts its inputs once per comparison, locates the requested range using
binary search, and accumulates day/category totals with the interval calculation.
It retains the immediately preceding event for midnight overlaps and system
boundaries, along with the existing four-hour activity ceiling.

## Controlled measurement, 27 October 2026

The deterministic fixture contains 33,600 synthetic events over 70 days. Each
iteration computes a weekly period and both dashboard comparisons. Ten iterations
on the same Mac and Bun runtime produced:

| Measurement | Before | Optimized |
| --- | ---: | ---: |
| Wall time | 426.73 ms | 39.04 ms |
| Process CPU time | 532.19 ms | 47.77 ms |

Both implementations returned matching totals and comparison results. Another 200
deterministic randomized period calculations matched the prior implementation.
Equal-duration category rows are compared by identity rather than display order.

Run the calculation fixture without services or personal data:

```sh
bun run benchmark:analytics
# Optional: compare outputs and timing with an earlier analytics module.
bun server/scripts/benchmark-analytics.ts /path/to/previous-analytics.ts
```

In packaged-app checks with an isolated, paused demo profile and a simulated
125-second hidden interval, the previous build issued one analytics request and
one plan request. The optimized build issued neither. Visible refresh, immediate
reopen refresh, minimize/restore, and zero renderer exceptions were verified.
Native controller tests also verified that live notch clocks retain one-second
updates and paused/hidden clocks stop.

## Local model and notch load, 14 November 2026

A day of normal use (13 November) cost about 580 local-model requests and
roughly 32 minutes of full-load inference, with 37 model reloads. Of 414 events
that ran the model, only 172 had a distinct activity and context: most were the
same window or page classified again. The notch helper was the largest steady
consumer outside the model, driven by a 10 Hz window-list poll.

Changes, all in-process and none persisted:

- **Decision memo.** `provider.ts` keeps a bounded in-memory memo (512 entries,
  6 hours) of validated decisions, keyed by a SHA-256 of the complete request
  (model, prompt, target refs, learning example ids). A repeated identical
  request skips the model and records zero attempts. Failures and invalid output
  are never stored. Corrections, app rules and preferences are applied outside
  the provider and stay live.
- **Recent Firefox page decision.** A resolved model decision for the same page
  and title in the same classification context is reused for 10 minutes, even
  when the page text differs slightly. Reused events are stored as history and
  cannot extend the window. Uncertain results and time-limited policy outcomes
  are always recomputed. A page that keeps its URL and title but changes subject
  can therefore be noticed up to 10 minutes late.
- **Keep-alive 5 minutes** (was 2) to avoid repeated cold model loads during
  active work.
- **Notch overlap polling.** The 100 ms window-list sample now runs at 500 ms
  until the pointer reaches the top of the screen, then at 100 ms for 3 seconds,
  and always at 100 ms while the pills are hidden. Another notch app opened
  without any pointer movement can hide the pills up to 500 ms late.
- **Notch clock cadence.** Collapsed minute-only timers redraw at their next
  minute boundary and a lone session progress line every 15 seconds. Anything
  showing seconds, and the expanded view, still ticks once per second.
- **Firefox companion 1.2.1.** Ancestor exclusion is memoized per read instead
  of walking up the tree for every text node; extracted page text is identical.
- **Timeline payload.** The date-range query no longer returns classifier-only
  fields that the latest-event query still provides: about 40 % smaller
  (666 KB instead of 1,120 KB for the 931 events of 13 November).

Measured on the same Mac and the same day (previous build versus this one, each
helper run standalone and idle for 60 seconds, two interleaved rounds, with the
watched notch app running):

| Notch helper | Previous | Now |
| --- | ---: | ---: |
| Idle CPU | 0.55 % and 0.85 % | 0.12 % and 0.10 % |
| Running minutes-only timer | 0.65 % and 0.77 % | 0.52 % and 0.20 % (pointer near the notch inflated the first) |

One window-list query costs about 0.9 ms, which is why the 10 Hz poll was the
dominant idle cost. The decision memo was checked against the real local model:
an identical request took 3.4 s the first time and 0 ms the second, and a changed
title was recomputed. The reduction in total model time over a working day is
not yet measured; the data only bounds it: 58 % of the model runs on
13 November repeated an activity and context already decided that day.

These measurements show reduced calculation work and background requests. They
are not a measurement of battery life or whole-application energy consumption.
Local model inference and real foreground activity can dominate total usage.
