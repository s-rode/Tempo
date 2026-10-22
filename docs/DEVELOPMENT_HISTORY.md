# Curated history and ongoing development

The publication history is reconstructed from the local development sequence against reviewed MIT source and local compatibility interfaces. It does not import the recovery repository's ancestry, tags, private configuration or backup refs. Original author dates identify the actual development work; new committer dates identify reconstruction. Samuel's public identity uses `47924596+s-rode@users.noreply.github.com`.

The mapping in `publication/history-map.json` accounts for every original commit. Individual feature-file changes are retained where practical; obsolete, redundant or dependency-bound changes are consolidated with an explicit reason. Intermediate curated feature steps are not claimed to be independently validated historical app builds. The final integrated checkout is the development/build target.

## After handoff

Continue normal development in this repository and commit your own work normally. The initial reconstruction mapping remains a fixed record of the original checkpoint; new development does not require another replay or access to the private recovery checkout.

Before committing, update the inventory:

```sh
bun run provenance:inventory
```

New or changed content is marked for review, rather than automatically approved. Record a concrete decision after inspecting your changes, for example:

```sh
bun run provenance:inventory --record path/to/changed.ts \
  --disposition tempo_addition_reviewed \
  --note 'My new implementation of the documented behavior; reviewed the staged diff.'
bun run publication:check
```

Use `reviewed_mit_adaptation` or `third_party_terms_recorded` and `--source` when appropriate, retaining relevant notices. A review note records evidence and responsibility; it is not an automatic legal clearance. The tool keeps old content reviews so every reachable revision remains auditable. It never needs private backups, database content or the recovery archive for routine development.

Commit the changed source and updated review ledgers together. Keep the source-history gate distinct from runtime acceptance: code can pass source checks while still needing model, browser, native UI or installed-app testing.
