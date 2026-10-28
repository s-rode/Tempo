import { expect, test } from 'bun:test'
import { join } from 'node:path'
test('calendar connection, permission revocation, and idempotent stop/restart retain one IPC owner', () => {
  const child = Bun.spawnSync({
    cmd: [process.execPath, join(import.meta.dir, 'fixtures/calendarIntegration.ts')],
    stdout: 'pipe',
    stderr: 'pipe'
  })
  if (child.exitCode) throw Error(new TextDecoder().decode(child.stderr))
  expect(new TextDecoder().decode(child.stdout)).toContain('Calendar lifecycle verified')
})
