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

These measurements show reduced calculation work and background requests. They
are not a measurement of battery life or whole-application energy consumption.
Local model inference and real foreground activity can dominate total usage.
