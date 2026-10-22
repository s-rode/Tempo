import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { resolveRuntimeProfile } from './runtimeProfile'

app.setName('Tempo')
export const runtime = resolveRuntimeProfile(process.env, join(app.getPath('appData'), 'Tempo'))
if (runtime.test) {
  mkdirSync(runtime.dataDir, { recursive: true, mode: 0o700 })
  app.setPath('userData', runtime.dataDir)
}
