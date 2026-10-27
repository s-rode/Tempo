import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { resolveDistractionSound } from '../../../shared/distractionSound'

const execute = promisify(execFile)

/** Use the Mac's own recordings; never redistribute Apple's sound files. */
async function convertSystemSound(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tempo-sound-'))
  try {
    const output = join(directory, 'alert.wav')
    // Chromium does not reliably decode AIFF. Convert on demand, once per sound.
    await execute('/usr/bin/afconvert', [
      '/System/Library/Sounds/' + name + '.aiff', output, '-f', 'WAVE', '-d', 'LEI16'
    ], { timeout: 5000 })
    return 'data:audio/wav;base64,' + (await readFile(output)).toString('base64')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export function createDistractionSoundLoader(convert = convertSystemSound) {
  const cache = new Map<string, Promise<string>>()
  return (value?: unknown): Promise<string> => {
    const sound = resolveDistractionSound(value)
    let pending = cache.get(sound.id)
    if (!pending) {
      pending = convert(sound.name).catch((error) => {
        cache.delete(sound.id)
        throw error
      })
      cache.set(sound.id, pending)
    }
    return pending
  }
}

export const loadDistractionSound = createDistractionSoundLoader()
