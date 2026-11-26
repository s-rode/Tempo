import { describe, expect, test } from 'bun:test';
import { profileFromPurpose, TOOL_PROFILE_REVISION, TOOL_PURPOSES } from './toolProfilePolicy';

describe('tool profile from its primary purpose', () => {
  test('a tool built for one work method is specialized for exactly that method', () => {
    expect(profileFromPurpose('study_notes_or_retrieval')).toEqual({
      role: 'specialized',
      supportingModes: ['study_notes_or_retrieval'],
      revision: TOOL_PROFILE_REVISION,
      purpose: 'study_notes_or_retrieval',
    });
    expect(profileFromPurpose('calculation_or_visualization').supportingModes).toEqual([
      'calculation_or_visualization',
    ]);
  });
  test('media, communication, utilities and general tools support no method', () => {
    for (const purpose of [
      'media_or_entertainment',
      'communication',
      'system_utility',
      'general_purpose',
    ] as const)
      expect(profileFromPurpose(purpose)).toMatchObject({
        role: 'general_purpose',
        supportingModes: [],
      });
  });
  test('an unfamiliar tool stays unknown', () => {
    expect(profileFromPurpose('unknown')).toMatchObject({ role: 'unknown', supportingModes: [] });
  });
  test('never grants resource navigation as a specialized method', () => {
    for (const purpose of TOOL_PURPOSES)
      expect(profileFromPurpose(purpose).supportingModes).not.toContain('resource_navigation');
  });
});
