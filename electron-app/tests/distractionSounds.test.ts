import { describe, expect, mock, test } from 'bun:test'
import { createDistractionSoundLoader } from '../src/main/distractionSounds'
import { DISTRACTION_SOUNDS } from '../../shared/distractionSound'

describe('macOS alert sound loading', () => {
  test('coalesces concurrent loads and never passes arbitrary paths to conversion', async () => {
    const convert = mock(async (name: string) => 'decoded:' + name)
    const load = createDistractionSoundLoader(convert)
    expect(await Promise.all([load('tink'), load('tink')])).toEqual(['decoded:Tink', 'decoded:Tink'])
    expect(convert).toHaveBeenCalledTimes(1)
    expect(await load('../../private')).toBe('decoded:Pop')
    expect(await load()).toBe('decoded:Pop')
    expect(convert).toHaveBeenCalledTimes(2)
  })

  test('a failed conversion can be retried rather than poisoning the cache', async () => {
    const convert = mock()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce('decoded:Glass')
    const load = createDistractionSoundLoader(convert)
    await expect(load('glass')).rejects.toThrow('unavailable')
    expect(await load('glass')).toBe('decoded:Glass')
  })

  test.skipIf(process.platform !== 'darwin')('all offered macOS sounds convert into playable PCM WAV', async () => {
    const load = createDistractionSoundLoader()
    for (const sound of DISTRACTION_SOUNDS) {
      const url = await load(sound.id)
      const wav = Buffer.from(url.split(',')[1], 'base64')
      expect(wav.subarray(0, 4).toString()).toBe('RIFF')
      expect(wav.subarray(8, 12).toString()).toBe('WAVE')
      expect(wav.length).toBeGreaterThan(1000)
    }
  })
})
