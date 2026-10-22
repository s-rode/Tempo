import { spawnSync, spawn } from 'node:child_process';
import { join } from 'node:path';
const root = join(import.meta.dir, '..');
for (const args of [
  ['run', 'build:shared'],
  ['run', '--cwd', 'electron-app', 'build:assets'],
  ['run', '--cwd', 'electron-app', 'build:notch-helper'],
  ['run', '--cwd', 'electron-app', 'build:firefox-host'],
  ['run', '--cwd', 'server', 'build:local'],
]) {
  const result = spawnSync('bun', args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const child = spawn('bun', ['run', '--cwd', 'electron-app', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    TEMPO_TEST_PROFILE_DIR: process.env.TEMPO_TEST_PROFILE_DIR || join(root, '.tempo-dev'),
  },
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code || 0));
