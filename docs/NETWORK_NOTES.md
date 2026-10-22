# Network and stored data

Normal desktop operation uses the loopback Tempo API (port 3001), MongoDB (27017), and Ollama (11434). The isolated development profile uses its own API port and database. The Firefox companion uses native messaging and a private Unix socket. Building dependencies, obtaining a model and opening a requested help/debugging page are separate from normal monitoring.

Hosted authentication, payments, S3 upload, telemetry and updater integrations are excluded from this source port. There is no cloud inference fallback. The native notch helper exchanges display/control JSON with Electron and makes no network requests.

Browser page-body evidence is transient. Firefox uses the companion and optional OCR; Chrome/Safari can read body text through Apple Events if scripting is enabled. Their inherited extraction does not apply the Firefox companion’s viewport/editable-content filters. New browser activity records omit the dedicated raw `content` and `url` fields. OCR images are processed in memory. Model prompts and complete model replies are not stored. This does **not** mean activity history is anonymous: app names, window titles, categories, derived summaries, timestamps, opaque fingerprints and classification metadata remain in MongoDB. Titles and generated summaries can themselves contain sensitive information.

Goals, task/list context, estimates, correction records and session history are also stored locally. Reminders integration reads Apple data and stores Tempo metadata; it does not complete or edit Apple reminders. The notch receives selected display text and session/category state, without authentication tokens or raw page bodies. Its compatible interface still accepts optional historical URL metadata.

Historical database records are preserved without a destructive schema or privacy migration. Older raw fields, legacy screenshot links or locally saved files may therefore remain in existing data and backups. Inspect and protect those separately before sharing any diagnostic export; do not publish a database or application-support directory.

Legacy import is an explicit copy into an empty destination. It leaves the legacy database, support files and app intact. See [BUILDING](BUILDING.md) for import, backup and rollback instructions. The repository excludes private environment files, runtime secrets, activity fixtures and generated app bundles.
