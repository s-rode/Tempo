import { describe, expect, test } from 'bun:test';
import {
  isIdentifierStyleTitle,
  isSourceFileInOtherLanguage,
  isToolSettingsTitle,
  isVisibleSubjectGrounded,
  validateFocusedEvidence,
} from './classificationEvidence';

const target = {
  ref: 'session:flashcards',
  scope: 'session' as const,
  text: 'review flashcards in RemNote',
  textFingerprint: 'goal',
  supportProfile: {
    subjectCues: ['flashcard', 'recall'],
    expectedOutcome: 'Review the planned flashcards.',
    supportingModes: ['study_notes_or_retrieval' as const, 'calculation_or_visualization' as const],
    revision: 'profile',
  },
};

const decision = {
  state: 'focused' as const,
  relation: 'supporting' as const,
  targetAlias: 'T1',
  matchedGoalRef: target.ref,
  supportingMode: 'study_notes_or_retrieval' as const,
  confidence: 'high' as const,
  categoryAlias: 'Work',
};

test('rejects a low-confidence generic supporting-method guess', () => {
  const result = validateFocusedEvidence({
    decision: { ...decision, confidence: 'low' },
    target,
    activity: { ownerName: 'Firefox', title: 'Raycast - Your shortcut to everything' },
    descriptor: {
      pageKind: 'general_browsing',
      actionLabel: 'searching for extensions',
      topicCues: ['extensions'],
      evidenceQuality: 'strong',
      source: 'ocr',
    },
  });
  expect(result.accepted).toBe(false);
  expect(result.observedSupportingMethod).toBe(false);
});

test('never turns a generated profile cue into direct evidence by itself', () => {
  const result = validateFocusedEvidence({
    decision: { ...decision, state: 'distracted', relation: 'none', supportingMode: null },
    target: {
      ...target,
      supportProfile: { ...target.supportProfile, subjectCues: ['extensions'] },
    },
    activity: { ownerName: 'Firefox', title: 'Extensions gallery' },
    descriptor: {
      pageKind: 'general_browsing',
      actionLabel: 'searching for extensions',
      topicCues: ['extensions'],
      evidenceQuality: 'strong',
      source: 'ocr',
    },
  });
  expect(result.accepted).toBe(false);
  expect(result.matchedTokens).toEqual([]);
});

test('recognizes a tool and subject explicitly named by the goal', () => {
  const result = validateFocusedEvidence({
    decision: { ...decision, state: 'distracted', relation: 'none', supportingMode: null },
    target,
    activity: { ownerName: 'RemNote', title: 'Flashcard Queue | Advanced Machine Learning' },
    descriptor: {
      pageKind: 'learning',
      actionLabel: 'reviewing flashcards',
      topicCues: ['machine learning'],
      evidenceQuality: 'strong',
      source: 'title',
    },
  });
  expect(result.accepted).toBe(true);
  expect(result.deterministicDirect).toBe(true);
  expect(result.explicitApplicationMatch).toBe(true);
});

test('accepts a high-confidence visibly compatible supporting tool', () => {
  const exerciseTarget = {
    ...target,
    text: 'solve the machine learning exercise sheet',
    supportProfile: {
      ...target.supportProfile,
      subjectCues: ['machine learning', 'exercises'],
    },
  };
  const result = validateFocusedEvidence({
    decision: {
      ...decision,
      matchedGoalRef: exerciseTarget.ref,
      supportingMode: 'calculation_or_visualization',
    },
    target: exerciseTarget,
    activity: { ownerName: 'Firefox', title: 'Graphing Calculator' },
    descriptor: {
      pageKind: 'problem_solving',
      actionLabel: 'graphing equations',
      topicCues: ['equations'],
      evidenceQuality: 'strong',
      source: 'dom',
    },
  });
  expect(result.accepted).toBe(true);
  expect(result.observedSupportingMethod).toBe(true);
});

describe('confidence boundary', () => {
  test('supporting work requires high confidence even with a visible method', () => {
    const result = validateFocusedEvidence({
      decision: { ...decision, confidence: 'medium' },
      target: {
        ...target,
        text: 'solve exercises',
        supportProfile: { ...target.supportProfile, subjectCues: [] },
      },
      activity: { ownerName: 'Firefox', title: 'Flashcard Tool' },
      descriptor: {
        pageKind: 'learning',
        actionLabel: 'reviewing flashcards',
        topicCues: [],
        evidenceQuality: 'strong',
        source: 'dom',
      },
    });
    expect(result.accepted).toBe(false);
  });
});

describe('visible subject grounding', () => {
  test('accepts subjects read from the title, hostname or page text', () => {
    expect(
      isVisibleSubjectGrounded('Dominated convergence theorem', [
        'Dominated convergence theorem - Wikipedia',
      ])
    ).toBe(true);
    expect(isVisibleSubjectGrounded('JWT verification', ['verifyJwt.ts — api-gateway'])).toBe(true);
    expect(
      isVisibleSubjectGrounded('Kalman filter', [
        'Chapter 7',
        'probml.github.io',
        'The Kalman filter performs exact Bayesian filtering',
      ])
    ).toBe(true);
    expect(isVisibleSubjectGrounded('Maßtheorie', ['Skript Maßtheorie WS25.pdf'])).toBe(true);
    expect(isVisibleSubjectGrounded('线性代数', ['线性代数 讲义'])).toBe(true);
  });
  test('rejects subjects that are absent from the evidence', () => {
    expect(isVisibleSubjectGrounded('graph theory lecture', ['Celebrity news'])).toBe(false);
    expect(isVisibleSubjectGrounded('market making', ['Discover Weekly'])).toBe(false);
    expect(isVisibleSubjectGrounded(null, ['Anything'])).toBe(false);
    expect(isVisibleSubjectGrounded('2026', ['Scan 2026'])).toBe(false);
    expect(isVisibleSubjectGrounded('topic', [null, ''])).toBe(false);
  });
});

describe('identifier-style titles', () => {
  test('file and project names are identifiers', () => {
    for (const [title, app] of [
      ['Practice2_CarMarket.ipynb — interview-notebooks', 'Code'],
      ['PhotoApp — AppDelegate.swift — Edited', 'Xcode'],
      ['README.md — dotfiles — Visual Studio Code', 'Visual Studio Code'],
      ['analysis_final_v2.ipynb', 'JupyterLab'],
    ])
      expect(isIdentifierStyleTitle(title, app)).toBe(true);
  });
  test('descriptive titles are not, even with a file extension', () => {
    for (const [title, app] of [
      ['Numerical Analysis – Lecture 9: Runge-Kutta methods.pdf', 'Preview'],
      ['Organic chemistry reaction mechanisms', 'RemNote'],
      ['Celebrity gossip and holiday shopping', 'Notes'],
      ['brew upgrade — updating casks', 'Terminal'],
    ])
      expect(isIdentifierStyleTitle(title, app)).toBe(false);
  });
});

describe('isSourceFileInOtherLanguage', () => {
  test('a source file in a language no task names conflicts with the task', () => {
    expect(isSourceFileInOtherLanguage('main.py — discord-music-bot', ['Prepare Java exam'])).toBe(
      true
    );
    expect(isSourceFileInOtherLanguage('Server.java — chat', ['Learn Rust ownership'])).toBe(true);
  });
  test('the same language, a sibling language or an unnamed language does not', () => {
    expect(isSourceFileInOtherLanguage('Main.java — exam-prep', ['Prepare Java exam'])).toBe(false);
    expect(
      isSourceFileInOtherLanguage('vite.config.js — web', ['Port the form to TypeScript'])
    ).toBe(false);
    expect(
      isSourceFileInOtherLanguage('main.rs — algos', ['Implement binary search tree deletion'])
    ).toBe(false);
    expect(isSourceFileInOtherLanguage('main.py — tools', ['Rewrite the Python CLI in Rust'])).toBe(
      false
    );
    expect(isSourceFileInOtherLanguage('App.js — site', ['Prepare JavaScript exam'])).toBe(false);
  });
  test('a non-code file or a task without a language never conflicts', () => {
    expect(isSourceFileInOtherLanguage('notes.md — java-course', ['Prepare Java exam'])).toBe(
      false
    );
    expect(isSourceFileInOtherLanguage('main.go — cli', ['Go through the Java slides'])).toBe(true);
    expect(isSourceFileInOtherLanguage('main.py — cli', ['Go through the lecture slides'])).toBe(
      false
    );
  });
  test('every active task must name a different language', () => {
    expect(
      isSourceFileInOtherLanguage('main.py — bot', ['Prepare Java exam', 'Fix the image cache'])
    ).toBe(false);
  });
});

describe('isToolSettingsTitle', () => {
  test("editor and shell configuration is the tool's own settings", () => {
    for (const title of [
      'keybindings.json — User',
      'settings.json — User — Visual Studio Code',
      '~/.zshrc',
      'README.md — dotfiles — Visual Studio Code',
    ])
      expect(isToolSettingsTitle(title, ['Migrate the events collection to SQLite'])).toBe(true);
  });
  test('project files and tasks about tooling are not', () => {
    expect(isToolSettingsTitle('settings.json — api-gateway', ['Refactor auth'])).toBe(false);
    expect(isToolSettingsTitle('ci.yml — .github/workflows', ['Refactor auth'])).toBe(false);
    expect(isToolSettingsTitle('keybindings.json — User', ['Configure editor shortcuts'])).toBe(
      false
    );
  });
});
