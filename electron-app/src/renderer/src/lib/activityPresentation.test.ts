import { describe, expect, test } from 'bun:test'
import { displayActivityLabel, displayActivitySummary } from './activityPresentation'

describe('activity presentation', () => {
  test('keeps an old focus-flavored label from resurfacing for a distraction', () => {
    const activity = {
      isProductive: false,
      ownerName: 'ChatGPT',
      activityLabel: 'Study Focus',
      activitySummary: 'Continuing focus goal · organize life calendar',
      categoryReasoning: 'Matched history'
    }

    expect(displayActivityLabel(activity)).toBe('Distracted by ChatGPT')
    expect(displayActivitySummary(activity)).toBe('Does not support the current goal.')
  })

  test('shows an explicitly tagged personal off-goal summary', () => {
    expect(
      displayActivitySummary({
        isProductive: false,
        activitySummary: 'Off goal: Reading travel questions instead of reviewing notes.'
      })
    ).toBe('Off goal: Reading travel questions instead of reviewing notes.')
  })
})
