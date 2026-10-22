import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const node = process.env.TEMPO_NODE22 || 'node';
const version = spawnSync(node, ['--version'], { encoding: 'utf8' });
if (!/^v22\./.test(version.stdout || ''))
  throw new Error('Use Node 22 on PATH, or set TEMPO_NODE22 to its executable.');
const result = spawnSync(
  node,
  [
    join(import.meta.dir, '../node_modules/electron-rebuild/lib/src/cli.js'),
    '-f',
    '-m',
    'src/native-modules/native-windows',
    '--arch',
    'arm64',
  ],
  {
    cwd: join(import.meta.dir, '../electron-app'),
    stdio: 'inherit',
    env: process.env,
  }
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
