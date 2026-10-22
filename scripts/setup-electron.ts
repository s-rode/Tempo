import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Dependency installation deliberately disables lifecycle scripts. Electron's
// pinned development runtime is the one required bootstrap performed explicitly.
const root = join(import.meta.dir, '..');
const node = process.env.TEMPO_NODE22 || 'node';
const result = spawnSync(node, [join(root, 'node_modules/electron/install.js')], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
