import { describe, expect, test } from 'bun:test';
import {
  descriptorRevision,
  fallbackPageDescriptor,
  sanitizeDerivedDescriptorText,
} from './pageDescriptors';

describe('privacy-safe page descriptors', () => {
  test('fallback uses retained title facts and never captured page text', () => {
    const result = fallbackPageDescriptor({
      ownerName: 'Firefox',
      title: 'Interview Questions',
      siteHost: 'private.example',
      content: 'secret raw page content',
      contentSource: 'dom',
    });
    expect(result.actionLabel).toBe('Interview Questions');
    expect(JSON.stringify(result)).not.toContain('secret raw page content');
    expect(JSON.stringify(result)).not.toContain('private.example');
  });

  test('redacts URLs and hostnames from bounded derived text', () => {
    expect(sanitizeDerivedDescriptorText('Reading https://private.example/path now')).toBe(
      'Reading [page] now'
    );
    expect(sanitizeDerivedDescriptorText('Browsing private.example')).toBe('Browsing [page]');
  });

  test('descriptor revisions are deterministic and content-sensitive', () => {
    const first = fallbackPageDescriptor({ ownerName: 'Mail', title: 'Inbox' });
    expect(descriptorRevision(first)).toBe(descriptorRevision(first));
    expect(descriptorRevision(first)).not.toBe(
      descriptorRevision({ ...first, actionLabel: 'Writing a draft' })
    );
  });
});
