# Classification validation

The fixed authored regression inputs are `server/evaluation/scenarios-v2.json` (120 cases) and `adversarial-v2.json` (15 cases). They cover relevant, unrelated, opaque and held-out transfer scenarios. They are synthetic inputs rather than an independently collected production accuracy dataset. Correction frequency and productive-time percentages are not accuracy measures.

The saved `baseline-v1.json`, `release-v2.json` and `adversarial-release-v2.json` reports come from development before this publication port. They remain historical evidence, **not verification of the ported candidate**. Current candidate checks are recorded in [publication status](publication/STATUS.md). The original and candidate each passed all 120 standard and 15 adversarial cases using actual local inference; [comparison metadata](publication/model-comparison.json) records model/version/settings and source/report hashes. These fixed cases do not establish real-world accuracy.

The evaluation script accepts an output file, `--candidate`, `--baseline=...`, `--adversarial`, `--pace-ms=1500` and `--replay=...`. Replay checks deterministic policy against saved semantic proposals and must not be described as live inference or measured model latency. Use the same model, settings and fixed expectations for original/candidate comparisons. Record technical failures, abstention, latency and transfer outcomes separately; never weaken expected labels to obtain a pass.

`bun run test` checks deterministic source fixtures. `bun run test:integration` exercises real routers with uniquely named disposable MongoDB databases, including correction scope, retries, navigation reuse, sampling, system boundaries, Reminders metadata and explicit import. It does not read or modify Apple reminders.

Source tests, real-model runs, staged app behavior and installed app behavior are separate verification levels. A passing build or unit test does not establish actual browser capture, notch interaction or permission continuity.
