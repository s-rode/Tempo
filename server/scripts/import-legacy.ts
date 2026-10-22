import { copyFile, mkdir, access, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { importLegacyDatabase } from '../src/services/tempoMigration';

if (!process.argv.includes('--confirm-copy')) {
  throw new Error(
    'Quit Tempo first. Run with --confirm-copy to copy legacy data into an empty Tempo database. The source is retained.'
  );
}
const health = await fetch('http://127.0.0.1:3001/health', {
  signal: AbortSignal.timeout(1000),
}).catch(() => null);
if (health) throw new Error('Quit Tempo and its local server before importing.');
const result = await importLegacyDatabase(
  process.env.TEMPO_IMPORT_SOURCE_URI || 'mongodb://127.0.0.1:27017/cronus_local',
  process.env.TEMPO_IMPORT_TARGET_URI || 'mongodb://127.0.0.1:27017/tempo_local'
);
const support = join(homedir(), 'Library', 'Application Support');
for (const relative of process.argv.includes('--copy-runtime-secrets')
  ? ['local-runtime/jwt-secret', 'firefox-navigation-secret']
  : []) {
  const source = join(support, 'Kronus', relative),
    target = join(support, 'Tempo', relative);
  if (
    !(await access(source).then(
      () => true,
      () => false
    ))
  )
    continue;
  if (
    await access(target).then(
      () => true,
      () => false
    )
  )
    continue;
  await mkdir(join(target, '..'), { recursive: true, mode: 0o700 });
  await copyFile(source, target, 1);
  await chmod(target, 0o600);
}
console.log(
  `Verified ${result.copied} copied records. Legacy data and applications were left intact.`
);
