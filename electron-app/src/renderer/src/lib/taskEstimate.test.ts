import { describe, expect, test } from 'bun:test'
import { parseTaskEstimate, pomodoroSummary } from './taskEstimate'

describe('Today’s Plan time suffix', () => {
  test.each([
    ['Regression: OLS & Bias-Variance 45 min', 'Regression: OLS & Bias-Variance', 45],
    ['Review flashcards 90m', 'Review flashcards', 90],
    ['Review algorithms 1h 30m', 'Review algorithms', 90],
    ['Read chapter 45', 'Read chapter 45', null],
    ['45 min', '45 min', null],
  ])('%s', (input, title, minutes) => {
    const result = parseTaskEstimate(input)
    expect(result.title).toBe(title)
    expect(result.estimatedMinutes).toBe(minutes)
  })

  test('a partial final Pomodoro block adds only an intermediate break', () => {
    expect(pomodoroSummary(45)).toContain('2 work blocks · 1 break · 5m break time')
  })
})
