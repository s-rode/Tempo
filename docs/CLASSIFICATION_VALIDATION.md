# Classification validation

The fixed authored regression inputs are `server/evaluation/scenarios-v2.json` (120 cases) and `adversarial-v2.json` (15 cases). They cover relevant, unrelated, opaque and held-out transfer scenarios. They are synthetic inputs rather than an independently collected production accuracy dataset. Correction frequency and productive-time percentages are not accuracy measures.

The saved `baseline-v1.json`, `release-v2.json` and `adversarial-release-v2.json` reports are historical development results, not verification of the current checkout. Run the fixed scenarios against the version and model being evaluated. Synthetic results do not establish real-world accuracy.

The evaluation script accepts an output file, `--candidate`, `--baseline=...`, `--adversarial`, `--pace-ms=1500` and `--replay=...`. Replay checks deterministic policy against saved semantic proposals and must not be described as live inference or measured model latency. Use the same model, settings and fixed expectations for original/candidate comparisons. Record technical failures, abstention, latency and transfer outcomes separately; never weaken expected labels to obtain a pass.

`bun run test` checks deterministic source fixtures. `bun run test:integration` exercises real routers with uniquely named disposable MongoDB databases, including correction scope, retries, navigation reuse, sampling, system boundaries, Reminders metadata and explicit import. It does not read or modify Apple reminders.

Source tests, real-model runs, staged app behavior and installed app behavior are separate verification levels. A passing build or unit test does not establish actual browser capture, notch interaction or permission continuity.

## Hard scenarios (v3)

`server/evaluation/scenarios-v3.json` adds 331 authored cases in 14 categories: paraphrases and subtopics, sibling subjects in the same tool, keywords shared in another sense, noisy titles, windows with no visible subject, work files whose names do not reveal their subject, prompt injection in titles and page text, Firefox page text, several active tasks, developer workflows, communication, media, terse tasks that rely on their Reminders list, and tasks and pages in different languages. A case may list more than one acceptable label where the visible evidence is genuinely ambiguous.

The cases are split into `dev` (214) and `holdout` (117) with disjoint goals. Prompt and policy changes may be tuned against `dev` only. Run `holdout` once, on a finished change, and do not inspect its individual failures while still editing; otherwise it stops measuring anything.

From `server/`:

```sh
bun run classifier:eval:suite /tmp/dev.json --split=dev
bun run classifier:eval:suite /tmp/holdout.json --split=holdout --compare=/tmp/previous-holdout.json
```

The script calls the production foreground path (personalized prompt, then the deterministic policy) with no learned preferences and no tool profile, and scores one model reply under Balanced and Strict. It reports four error kinds separately because they cost different things: false focused (unearned productive time), false alarm (a distraction alert on real work), focus abstained (real work left uncertain) and missed distraction. Results are scored at steady state, after any 60-second navigation allowance; `--first-minute` scores the first minute instead. `--replay=` re-scores saved proposals with the current policy and is not live inference.

`baseline-v3.json` and `release-v3.json` record one development comparison on `qwen3:4b-instruct` (Balanced, steady state, 16 November 2026). Like the v2 reports they are historical, synthetic and not a measurement of real-world accuracy.

| Split         | Revision | Correct | False focused | False alarm | Focus abstained | Missed distraction |
| ------------- | -------- | ------: | ------------: | ----------: | --------------: | -----------------: |
| dev (214)     | before   |     166 |             9 |           4 |              17 |                 12 |
| dev (214)     | after    |     190 |             8 |           3 |               0 |                 17 |
| holdout (117) | before   |      96 |             4 |           1 |              12 |                  4 |
| holdout (117) | after    |     107 |             4 |           2 |               0 |                  7 |

Focus abstained counts real work left uncertain where uncertain is not an acceptable label. One dev case in the "after" run timed out and is counted as wrong.

Most of the gain is real work that no longer loses its credit after a minute, and empty windows that are now neutral instead of focused or distracted. The false-focused count barely moved, and the holdout split still shows two false alarms; the change did not make the model better at telling apart look-alike keywords or sibling subjects. Missed distractions went up because code or documents from a different project, identified only by a file name, are now neutral rather than flagged. That is deliberate: on real titles the model raised alerts on ordinary work files, and a neutral result lets one correction cover later files in the same tool. The 16 work-file cases were added after the first holdout run, in response to exactly such a report, so they are not an independent test of that rule.

Each suite result now also records `trace`: the model's own reply (`o`, `k`, `q`, `v`, `t`, `m`) and which server check, if any, changed it (`no_subject`, `file_name_only` or `ungrounded_subject`). The 16 November reports predate it, so they cannot show which of their opaque results came from the model and which from the file-name rule. With a trace, `--replay=` re-runs those checks on the saved replies, so a change to the server-side rules can be scored on `dev` without calling the model again. A change to the prompt still needs a live run.
