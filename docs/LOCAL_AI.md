# Tempo local AI

Tempo classifies activity exclusively through loopback Ollama. The default model
is `qwen3:4b-instruct`; `OLLAMA_MODEL` remains configurable. No cloud fallback
exists.

## Grounded semantic foreground classifier

For a stable activity, Tempo makes one goal-aware request over the original
transient evidence and the active session goal, Today plan, or weekly focus.
Qwen may use semantic equivalence, abbreviations, and ordinary world knowledge;
there is no literal token-overlap gate. A Focused answer must select an active
target and cite aliases for evidence that is actually present in the current
request. The server verifies those aliases and applies the selected Flexible,
Balanced, or Strict confidence policy without retaining their text.

Focused means that the visible action operates on the target subject, produces
a required output, or performs a necessary supporting method on goal-relevant
material. A generally useful tool or productivity activity is not sufficient.
Every other valid reply resolves to Distracted. Uncertain is reserved for an
unavailable/timed-out model or unreadable input. An invalid custom-category
alias falls back to the user's default category of the correct polarity.

After 12 seconds of unchanged activity, an optional second local request may
derive a short label, summary, explanation, and nudge copy. This enrichment is
cancelled on navigation, pause, lock, sleep, or a stale capture and never changes
the already applied category.

## Firefox page context and OCR fallback

The Firefox companion extracts a bounded title, description, heading set, and
sample of visible main-page text after stable navigation or a settled content
change in the active tab. It excludes editable
controls, password/form values, hidden elements, private tabs, privileged pages,
and browser UI. If DOM text is unavailable, Tempo captures one active-window
frame and uses Apple Vision OCR; if OCR is also unavailable, title and ephemeral
hostname still reach classification. Raw page context is cleared after the
request. New normal browser captures omit the dedicated page-text and URL fields and do not save OCR screenshots, prompts, or complete model replies. App names, window titles, derived model summaries and opaque fingerprints are stored; titles and summaries can still disclose sensitive context. Existing historical records are retained, including any older raw fields.

Chrome and Safari retain their Apple Events browser capture, including page body text when browser JavaScript access is enabled. Unlike the Firefox companion, that inherited body extraction is not limited to viewport text or the Firefox-specific exclusion rules. The renderer bounds it before transport.

Other native applications supply only their application name and window title. Tempo does not walk native application contents or use OCR outside the
Firefox fallback.

## Performance

Ollama is kept warm and every foreground pipeline has one ten-second deadline.
A malformed semantic reply receives one compact retry. Manual corrections and
same-content/same-goal history bypass the model. Only grounded medium/high
confidence decisions can seed automatic history or Firefox reuse; manual
corrections remain eligible regardless. Goal-only support profiles are generated
at low priority and learned correction examples are restricted to the same
native tool or opaque Firefox site family. `bun run classifier:eval` reports
privacy-safe aggregate latency, failure, and correction figures.

`TEMPO_CLASSIFIER_MODE=factored` temporarily restores the previous two-request
descriptor pipeline; `TEMPO_CLASSIFIER_MODE=legacy` restores the older core
classifier. Both switches are internal and intended only for one-release
rollback.
