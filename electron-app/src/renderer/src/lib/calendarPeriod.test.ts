import { expect, test } from 'bun:test'
import { calendarPeriod } from './calendarPeriod'

test('weekly dashboard queries retain Sunday boundaries across month and year rollover', () => {
  const selected = new Date(2026, 0, 1, 13, 45)
  const before = selected.getTime()
  const range = calendarPeriod(selected, 'week')
  expect(new Date(range.startDateMs)).toEqual(new Date(2025, 11, 28))
  expect(new Date(range.endDateMs)).toEqual(new Date(2026, 0, 4))
  expect(selected.getTime()).toBe(before)
})

test('local calendar queries span the real spring and autumn DST days', () => {
  const program = `import { calendarPeriod } from ${JSON.stringify(import.meta.dir + '/calendarPeriod.ts')};
    console.log(JSON.stringify([new Date(2026,2,29,12),new Date(2026,9,25,12)].map(date=>{
      const range=calendarPeriod(date,'day');return (range.endDateMs-range.startDateMs)/3600000;
    })));`
  const child = Bun.spawnSync({
    cmd: [process.execPath, '-e', program], env: { TZ: 'Europe/Berlin' },
    stdout: 'pipe', stderr: 'pipe'
  })
  expect(child.exitCode).toBe(0)
  expect(JSON.parse(new TextDecoder().decode(child.stdout))).toEqual([23, 25])
})
