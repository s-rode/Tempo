# Context-aware classification

Tempo combines a single local semantic interpretation with bounded explicit personal learning. The active task remains the target; sharing a list, an app, or a work method does not make another task productive.

## Evidence and decisions

The foreground model first identifies the specific visible subject and task subject, then reports productive, distracting, or uncertain. These subject strings remain transient. The server retains only the bounded semantic proposal, evidence aliases, final decision basis, and historical user-authored goal context. A repeated app name/window title is one signal, not independent topic evidence.

Visible unrelated activity overrides inferred preferences. Opaque activity may use a matching task correction, a qualified list preference, or a cached specialized tool capability compatible with the task. General-purpose tools receive no blanket approval. A model's low self-reported confidence cannot erase a concrete distracting verdict with visible evidence; low-confidence focus still requires stronger support. Technical failures remain neutral and never receive off-goal presentation.

Native apps retain the name/title-only boundary. Firefox may provide ephemeral page evidence as before. Goal-independent tool profiles are generated locally at low priority and never store hostnames, URLs, or captured text. Profile generation yields to foreground inference. Stable goal profiles are reused across sessions with identical classification text.

## Explicit learning

Events freeze task identity, list provenance, session identity, goal text, and profile/method revisions before inference. Corrections use that snapshot even after the live goal changes. A correction spanning multiple identifiable contexts is split for storage but retains one root action identity, so it cannot count as several independent confirmations. Reversals supersede earlier observations without deleting evaluation history.

List promotion requires compatible methods and proven list identity. Within the preceding 60 days:

| Policy | Actions | Sessions | Tasks |
| --- | ---: | ---: | ---: |
| Flexible | 2 | 2 | 2 |
| Balanced | 3 | 2 | 2 |
| Strict | 5 | 3 | 3 |

These counts establish workflow eligibility, not probabilities of correctness. Passive use, ignored alerts, automatic decisions, and cache hits never contribute. Daily planning contexts count as separate observation episodes on different days when there is no focus run.

An applicable negative observation suspends broad opaque trust until explicit reinstatement. Further positives cannot drown it out. Narrow task corrections remain separately reviewable. Broad preferences stop applying when the 60-day promotion requirements no longer hold, and all inferred preferences have a 90-day limit without explicit feedback. Forgetting removes the current evidence from effective trust; future explicit observations must establish the relationship again.

Legacy import is versioned and idempotent. Historical run segments can establish task/list provenance only where unambiguous. Generated prose such as “List: University” never proves list identity. Feedback without recoverable context stays narrow. Legacy records with no action identity are conservatively clustered by goal/tool/state and 30-second correction bursts. Existing exact corrections and historical classifications remain intact.

## Navigation and uncertainty

Resource navigation receives at most 60 seconds per tool/task/session episode. Its persisted start is not renewed by captures, dashboard changes, history reuse, or process restarts. Relevant task evidence or explicit confirmation can renew the allowance.

Uncertain time receives no productive credit or distraction sound. After two continuous minutes of semantic uncertainty, one silent notification offers to open the activity's relevance controls. The main process owns one event-driven timer; repeated captures update the target event without restarting it. Tool/task changes, resolved classification, and suspension end the episode. Ignoring the notification does not teach anything. Technical failures do not trigger relevance questions.

Distraction audio uses a main-process cooldown across captures and renderer remounts. Pending classifications, productive activity, and tracking pauses cancel playback without resetting that cooldown. A recurring deadline maintains the selected sound interval on an unchanged distracted page; no one-second sound polling is used. Distraction notifications are silent so system notification sounds cannot bypass the separate sound setting. Session transition chimes retain their own controls.

Unclassified and pending activity also has a visible **Choose category** control. Its category chooser labels productive and distracting choices explicitly. Opening or cancelling it changes no history or learning. If an upload has no saved event, saving a category prepares an observation without another model call or captured page text. It records the goal context at the explicit observation time, rather than inventing context for an earlier failed capture. Existing events retain their original historical context. Retries reuse the same capture identity, and a late model result cannot overwrite an explicit correction.

## Optional reviews and diagnostics

Completed focus sessions offer a collapsed review section. It samples contiguous automatically productive activity blocks: one uniformly drawn block, plus up to one learned-context block and one tool-role block. Selection is stable per session, deduplicated, and stored with its sampling stratum and conditional inclusion probability. The random and targeted strata must be reported separately.

Related/off-task labels are explicit feedback. Unsure and ignored samples add no learning label. Reversing a review is supported. Replacing a review label with unsure withdraws its active review observation.

Operational success means absence of a technical failure, not classification accuracy. Corrections are selection-biased toward false distraction alerts. Neither a falling correction count nor increasing productive time establishes improvement. Health diagnostics expose uncertainty and explicit review counts by stratum, without presenting them as global accuracy.

## Verification and rollback

`server/evaluation/scenarios-v2.json` contains 120 authored synthetic scenarios across 30 workflows. Each workflow includes relevant, unrelated, opaque, and held-out transfer cases. `adversarial-v2.json` adds trusted-tool, other-course, prompt-injection, and scope-boundary checks. These are regression fixtures, not a representative measurement of real-world accuracy.

From `server/`:

```sh
bun run classifier:eval:personalized /tmp/baseline.json
bun run classifier:eval:personalized /tmp/candidate.json --candidate --baseline=/tmp/baseline.json
bun run classifier:eval:personalized /tmp/adversarial.json --candidate --adversarial
bun run classifier:verify
```

The evaluation uses localhost Ollama and synthetic inputs, without database access. `--pace-ms=1500` yields between requests when Tempo is monitoring concurrently. `--replay=...` reruns only the deterministic policy on saved synthetic semantic proposals; reports identify replay versus live-model mode. Do not present replay execution time as inference latency. Runtime inference retains its ten-second deadline.

Release gates compare distraction recall, false productive classifications (including opaque cases incorrectly called productive), clear-distraction detection, held-out transfer false alarms, and transfer uncertainty. Technical failures and uncertainty must remain visible in the report. The isolated verification script creates and drops a uniquely named test database, never the user's Tempo database.

Set `TEMPO_PERSONALIZED_CLASSIFIER=disabled` in the desktop process environment for the existing semantic-v1 classifier. Policy fingerprints separate its automatic history from v2. Historical snapshots and explicit feedback continue to be recorded; rollback does not delete learning. The packaged API revision forces replacement of an incompatible older local server.
